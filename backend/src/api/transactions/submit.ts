import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  SubmissionError,
  getEnvelopeHash,
  getEnvelopeSourceAccount,
  parseSignedXdr,
  submissionService,
} from "@/lib/stellar/submission_service";

const submitSchema = z.object({
  signedXdr: z.string().trim().min(1, "signedXdr is required"),
});

/**
 * POST /api/transactions/submit
 *
 * Accepts a client-signed transaction envelope and submits it to the
 * Stellar/Soroban RPC network. The caller must be authenticated and the
 * envelope's source account must match the user's registered Stellar
 * address.
 *
 * Submission state is recoverable by design:
 * - The intent row (status "pending", deterministic transaction hash) is
 *   persisted BEFORE the network call, so a later failure — or a crash
 *   between submit and logging — leaves a row the transaction verifier
 *   can reconcile instead of a submitted transaction with no history.
 * - A terminal network rejection (ERROR) marks the intent "failed" so
 *   the verifier stops polling it. An unknown outcome (retries
 *   exhausted, RPC unreachable) leaves the intent "pending" so the
 *   verifier can complete it if the envelope did land.
 * - Re-submitting an already-seen envelope never fails on the unique
 *   hash index: the intent insert is conflict-safe, and an existing row
 *   is returned (after an ownership check) instead of erroring.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Unauthorized",
      );
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // Empty body; validation below will reject it.
    }

    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "signedXdr is required",
      );
    }

    const { signedXdr } = parsed.data;

    let parsedEnvelope: ReturnType<typeof parseSignedXdr>;
    try {
      parsedEnvelope = parseSignedXdr(signedXdr);
    } catch {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "signedXdr is not a valid signed transaction envelope",
      );
    }

    const sourceAccount = getEnvelopeSourceAccount(parsedEnvelope);
    // The Stellar transaction hash is a pure function of the envelope
    // and the network passphrase, so this is exactly the hash the
    // network will report for an accepted envelope.
    const txHash = getEnvelopeHash(parsedEnvelope);

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
    });

    if (!user) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "User not found",
      );
    }

    if (!user.stellarAddress) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "No Stellar address is registered for this user",
      );
    }

    if (user.stellarAddress !== sourceAccount) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "Transaction source account does not match the user's registered Stellar address",
      );
    }

    // Persist the submission intent before the network side effect.
    // The envelope carries no single value transfer (it may be a Soroban
    // invocation), so the history row records a zero amount; the fee asset
    // is XLM. The verifier job reconciles the row once the network
    // confirms or rejects the transaction.
    const intentValues = {
      userId: payload.userId,
      walletId: null,
      type: "blockchain_submission" as const,
      status: "pending" as const,
      amount: 0,
      currency: "XLM",
      provider: "soroban",
      blockchainTxHash: txHash,
    };

    const [intentRow] = await db
      .insert(transactions)
      .values(intentValues)
      .onConflictDoNothing({ target: transactions.blockchainTxHash })
      .returning({
        id: transactions.id,
        userId: transactions.userId,
        status: transactions.status,
        blockchainTxHash: transactions.blockchainTxHash,
      });

    // A previous submission for this exact envelope already exists.
    // Re-submitting is safe (the network dedupes it), but never return
    // another user's submission and never reset a terminal status
    // without a new accepted submission behind it.
    let existingStatus: string | null = null;
    let intentId: string | null = intentRow?.id ?? null;
    if (!intentRow) {
      const existing = await db.query.transactions.findFirst({
        where: eq(transactions.blockchainTxHash, txHash),
      });

      if (!existing) {
        console.error(
          "[TRANSACTION_SUBMIT_ERROR] Intent insert conflicted but no existing row was found",
          { txHash },
        );
        return createProblemDetails(
          "about:blank",
          "Internal Server Error",
          500,
          "Failed to submit transaction",
        );
      }

      if (existing.userId !== payload.userId) {
        return createProblemDetails(
          "about:blank",
          "Forbidden",
          403,
          "Transaction already submitted by another user",
        );
      }

      if (existing.status === "completed") {
        // Already confirmed on-chain: idempotent success, no RPC call.
        return NextResponse.json({
          success: true,
          hash: existing.blockchainTxHash ?? txHash,
          status: "success",
        });
      }

      // Pending, submitted, or failed: a previous attempt may have died
      // before the RPC call (failed can also mean the verifier timed out
      // on a never-confirmed envelope), so submit again below. The
      // network dedupes an envelope it already holds.
      existingStatus = existing.status;
      intentId = existing.id;
    }

    let result: { hash: string; status: "pending" | "success" };
    try {
      result = await submissionService.submitXdrToNetwork(signedXdr);
    } catch (error) {
      console.error("[TRANSACTION_SUBMIT_ERROR]", error);
      if (error instanceof SubmissionError) {
        if (error.terminal && intentId) {
          // Terminal rejection: the envelope can never succeed, so stop
          // the verifier polling this intent. Guarded to pending only,
          // so a row the verifier completed concurrently is untouched.
          // A failure to mark it is non-fatal: the verifier times out
          // pending rows and fails them itself.
          try {
            await db
              .update(transactions)
              .set({ status: "failed", updatedAt: new Date() })
              .where(
                and(
                  eq(transactions.id, intentId),
                  eq(transactions.status, "pending"),
                ),
              );
          } catch (updateError) {
            console.error(
              "[TRANSACTION_SUBMIT_ERROR] Failed to mark rejected submission as failed",
              updateError,
            );
          }
        }
        // Unknown outcome (retries exhausted): the intent stays pending
        // with its hash so the verifier can reconcile it if it landed.
        return createProblemDetails(
          "about:blank",
          "Bad Gateway",
          502,
          "Failed to submit the transaction to the Stellar network",
        );
      }
      throw error;
    }

    if (intentId && (existingStatus === "failed" || result.hash !== txHash)) {
      // The re-submission of a previously failed intent was accepted, or
      // (defensively) the network reported a different hash than the
      // deterministic one: reconcile the intent row with the accepted
      // state. Non-fatal — the intent row already exists with a hash the
      // verifier can reconcile, so never fail an accepted submission
      // over this bookkeeping update.
      try {
        await db
          .update(transactions)
          .set({
            status: "pending",
            blockchainTxHash: result.hash,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, intentId));
      } catch (updateError) {
        console.error(
          "[TRANSACTION_SUBMIT_ERROR] Failed to reconcile submission intent row",
          updateError,
        );
      }
    }

    return NextResponse.json({
      success: true,
      hash: result.hash,
      status: result.status,
    });
  } catch (error) {
    console.error("[TRANSACTION_SUBMIT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to submit transaction",
    );
  }
}
