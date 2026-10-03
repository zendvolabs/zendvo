import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { savingsHistory, transactions, users } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { SubmissionService } from "@/lib/stellar/submission_service";
import { TransactionBuilder, Networks } from "@stellar/stellar-sdk";
import {
  TelemetryService,
  extractTraceId,
} from "@/lib/services/telemetry_service";

export async function POST(request: NextRequest) {
  const traceId = extractTraceId(request);
  const elapsedTimer = TelemetryService.startTimer();
  let currentUserId: string | undefined;
  let userStellarAddress: string | undefined;

  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      TelemetryService.logSubmissionFailure({
        traceId,
        transactionType: "blockchain_submission",
        errorCode: 401,
        error: "Unauthorized",
        durationMs: elapsedTimer(),
      });
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Unauthorized",
      );
    }

    const { userId } = payload;
    currentUserId = userId as string;

    TelemetryService.logSubmissionStart({
      traceId,
      userId: currentUserId,
      transactionType: "blockchain_submission",
    });

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const signedXdr = body.signedXdr || body.xdr;

    if (!signedXdr || typeof signedXdr !== "string") {
      TelemetryService.logSubmissionFailure({
        traceId,
        userId: currentUserId,
        transactionType: "blockchain_submission",
        errorCode: 400,
        error: "Missing or invalid signed XDR",
        durationMs: elapsedTimer(),
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Missing or invalid signed XDR",
      );
    }

    // Submit the XDR to the network using the robust submission service
    const user = await db.query.users.findFirst({
      where: eq(users.id, currentUserId),
    });

    if (!user || !user.stellarAddress) {
      TelemetryService.logSubmissionFailure({
        traceId,
        userId: currentUserId,
        transactionType: "blockchain_submission",
        errorCode: 400,
        error: "User does not have a stellar address",
        durationMs: elapsedTimer(),
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "User does not have a stellar address",
      );
    }

    userStellarAddress = user.stellarAddress;

    const result = await SubmissionService.submitXdrToNetwork(signedXdr, user.stellarAddress);

    // Look up any matching savings history record for this transaction
    let targetHash: string | undefined = result.hash;
    if (!targetHash && signedXdr) {
      try {
        const networkPassphrase =
          process.env.STELLAR_NETWORK === "public"
            ? Networks.PUBLIC
            : Networks.TESTNET;
        const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
        targetHash = tx.hash().toString("hex");
      } catch {
        // ignore xdr parse error
      }
    }

    let matchingSavingsRecord = null;
    if (db.query?.savingsHistory) {
      if (targetHash) {
        matchingSavingsRecord = await db.query.savingsHistory.findFirst({
          where: and(
            eq(savingsHistory.userId, currentUserId),
            eq(savingsHistory.transactionHash, targetHash),
          ),
        });
      }

      if (!matchingSavingsRecord) {
        matchingSavingsRecord = await db.query.savingsHistory.findFirst({
          where: and(
            eq(savingsHistory.userId, currentUserId),
            eq(savingsHistory.status, "pending"),
          ),
          orderBy: [desc(savingsHistory.createdAt)],
        });
      }
    }

    if (result.success && result.hash) {
      if (matchingSavingsRecord) {
        await db
          .update(savingsHistory)
          .set({
            status: "completed",
            transactionHash: result.hash,
            updatedAt: new Date(),
          })
          .where(eq(savingsHistory.id, matchingSavingsRecord.id));

        const recordAmount = matchingSavingsRecord.amount;
        if (recordAmount > 0) {
          await db
            .update(users)
            .set({
              savingsBalance:
                matchingSavingsRecord.type === "deposit"
                  ? sql`${users.savingsBalance} + ${recordAmount}`
                  : sql`${users.savingsBalance} - ${recordAmount}`,
              savingsStatus: "active",
              updatedAt: new Date(),
            })
            .where(eq(users.id, currentUserId));
        }
      }

      // Log the submitted transaction in the database
      await db.insert(transactions).values({
        userId: currentUserId,
        amount: matchingSavingsRecord ? matchingSavingsRecord.amount : 0,
        currency: "USDC",
        type: "blockchain_submission" as const,
        status: "submitted" as const,
        reference: result.hash,
      });

      TelemetryService.logSubmissionSuccess({
        traceId,
        userId: currentUserId,
        transactionType: "blockchain_submission",
        stellarAddress: user.stellarAddress,
        txHash: result.hash,
        attempts: result.attempts,
        durationMs: elapsedTimer(),
      });

      return new Response(
        JSON.stringify({
          success: true,
          hash: result.hash,
          status: result.status,
          attempts: result.attempts,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (matchingSavingsRecord) {
      await db
        .update(savingsHistory)
        .set({
          status: "failed",
          errorMessage: result.error || "Transaction submission failed",
          updatedAt: new Date(),
        })
        .where(eq(savingsHistory.id, matchingSavingsRecord.id));
    }

    TelemetryService.logSubmissionFailure({
      traceId,
      userId: currentUserId,
      transactionType: "blockchain_submission",
      stellarAddress: user.stellarAddress,
      attempts: result.attempts,
      errorCode: 400,
      error: result.error || "Transaction submission failed",
      durationMs: elapsedTimer(),
    });

    // Return the error from the submission service
    return createProblemDetails(
      "about:blank",
      "Submission Failed",
      400,
      result.error || "Transaction submission failed",
    );
  } catch (error) {
    console.error("[TRANSACTION_SUBMIT_ERROR]", error);

    TelemetryService.logSubmissionFailure({
      traceId,
      userId: currentUserId,
      transactionType: "blockchain_submission",
      stellarAddress: userStellarAddress,
      errorCode: 500,
      error,
      durationMs: elapsedTimer(),
    });

    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to submit transaction",
    );
  }
}