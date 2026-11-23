import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  SubmissionError,
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
 * address. The submission is recorded in the transactions table as a
 * pending blockchain_submission for later reconciliation.
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

    let sourceAccount: string;
    try {
      sourceAccount = getEnvelopeSourceAccount(parseSignedXdr(signedXdr));
    } catch {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "signedXdr is not a valid signed transaction envelope",
      );
    }

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

    let result: { hash: string; status: "pending" | "success" };
    try {
      result = await submissionService.submitXdrToNetwork(signedXdr);
    } catch (error) {
      console.error("[TRANSACTION_SUBMIT_ERROR]", error);
      if (error instanceof SubmissionError) {
        return createProblemDetails(
          "about:blank",
          "Bad Gateway",
          502,
          "Failed to submit the transaction to the Stellar network",
        );
      }
      throw error;
    }

    // The envelope carries no single value transfer (it may be a Soroban
    // invocation), so the history row records a zero amount; the fee asset
    // is XLM. The verifier job reconciles the row once the network
    // confirms or rejects the transaction.
    await db.insert(transactions).values({
      userId: payload.userId,
      walletId: null,
      type: "blockchain_submission",
      status: "pending",
      amount: 0,
      currency: "XLM",
      provider: "soroban",
      blockchainTxHash: result.hash,
    });

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
