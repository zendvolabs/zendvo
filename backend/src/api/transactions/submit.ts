import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { SubmissionService } from "@/lib/stellar/submission_service";
import { SavingsService } from "@/server/services/savingsService";

/**
 * Submits a signed XDR to the Stellar network and records the transaction
 * in the database within an ACID transaction to ensure consistency.
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

    const { userId } = payload;

    const body = await request.json();
    const { signedXdr } = body;

    if (!signedXdr || typeof signedXdr !== "string") {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Missing or invalid signed XDR",
      );
    }

    // Submit the XDR to the network using the robust submission service
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId as string),
    });

    if (!user || !user.stellarAddress) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "User does not have a stellar address",
      );
    }

    const result = await SubmissionService.submitXdrToNetwork(signedXdr, user.stellarAddress);

    if (result.success && result.hash) {
      const submissionHash = result.hash;

      // Log the submitted transaction in the database within a transaction
      await db.transaction(async (tx) => {
        // Insert transaction record
        await tx.insert(transactions).values({
          userId: userId as string,
          amount: 0,
          currency: "USDC",
          type: "blockchain_submission" as const,
          status: "submitted" as const,
          reference: submissionHash,
        });

        // Record pending savings transaction
        // The actual type (deposit/withdrawal) will be determined by the webhook
        await SavingsService.recordPending(
          tx,
          userId as string,
          "deposit",
          submissionHash,
          user.vaultContractId || undefined,
        );
      });

      return new Response(
        JSON.stringify({
          success: true,
          hash: submissionHash,
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

    // Return the error from the submission service
    return createProblemDetails(
      "about:blank",
      "Submission Failed",
      400,
      result.error || "Transaction submission failed",
    );
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