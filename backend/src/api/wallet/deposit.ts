import { NextRequest, NextResponse } from "next/server";
import {
  DefindexService,
  DefindexServiceError,
} from "@/lib/services/defindex_service";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { db } from "@/lib/db";
import { savingsHistory, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  TelemetryService,
  extractTraceId,
} from "@/lib/services/telemetry_service";

export async function POST(request: NextRequest) {
  const traceId = extractTraceId(request);
  const elapsedTimer = TelemetryService.startTimer();
  let currentUserId: string | undefined;
  let requestedAmount: string | undefined;
  let userStellarAddress: string | undefined;

  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        transactionType: "deposit",
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 401,
        error: "Authentication required",
      });
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required",
      );
    }

    const { userId } = payload;
    currentUserId = userId;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const { amount } =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as { amount?: unknown })
        : {};

    if (typeof amount === "string") {
      requestedAmount = amount.trim();
    }

    TelemetryService.logXdrGenerationStart({
      traceId,
      userId,
      transactionType: "deposit",
      amount: requestedAmount,
      currency: "USDC",
    });

    if (typeof amount !== "string" || !amount.trim()) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId,
        transactionType: "deposit",
        amount: requestedAmount,
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "amount is required and must be a human-readable USDC amount string",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "amount is required and must be a human-readable USDC amount string (for example, 50.00)",
      );
    }

    const [user] = await db
      .select({ stellarAddress: users.stellarAddress })
      .from(users)
      .where(eq(users.id, userId));

    if (!user?.stellarAddress) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId,
        transactionType: "deposit",
        amount: requestedAmount,
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "No Stellar address registered for this account",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "No Stellar address registered for this account",
      );
    }

    userStellarAddress = user.stellarAddress;

    const result = await DefindexService.buildDeFindexDepositXdr(
      user.stellarAddress,
      amount.trim(),
    );

    try {
      await db.insert(savingsHistory).values({
        userId,
        vaultContractId: result.contractId,
        type: "deposit",
        status: "pending",
        amount: Number(amount.trim()) || Number(result.amount),
        currency: "USDC",
        transactionHash: result.txHash,
        sharePrice: result.sharePrice ? Number(result.sharePrice) : null,
        sharesBalance: result.userBalance ? Number(result.userBalance) : null,
      });
    } catch (dbError) {
      console.error("[SAVINGS_HISTORY_DEPOSIT_INSERT_ERROR]", dbError);
    }

    TelemetryService.logXdrGenerationSuccess({
      traceId,
      userId,
      transactionType: "deposit",
      amount: amount.trim(),
      currency: "USDC",
      stellarAddress: user.stellarAddress,
      txHash: result.txHash,
      durationMs: elapsedTimer(),
    });

    return NextResponse.json(
      { success: true, ...result },
      { status: 200 },
    );
  } catch (error) {
    console.error("[WALLET_DEPOSIT_ERROR]", error);

    const errorCode =
      error instanceof DefindexServiceError
        ? error.kind.toUpperCase()
        : "INTERNAL_ERROR";

    TelemetryService.logXdrGenerationFailure({
      traceId,
      userId: currentUserId,
      transactionType: "deposit",
      amount: requestedAmount,
      currency: "USDC",
      stellarAddress: userStellarAddress,
      durationMs: elapsedTimer(),
      errorCode,
      error,
    });

    if (error instanceof DefindexServiceError) {
      switch (error.kind) {
        case "configuration":
          return createProblemDetails(
            "about:blank",
            "Internal Server Error",
            500,
            "The DeFindex vault is not configured correctly",
          );
        case "upstream":
          return createProblemDetails(
            "about:blank",
            "Bad Gateway",
            502,
            "The DeFindex vault could not be reached or simulated at this time",
          );
        case "validation":
        default:
          return createProblemDetails(
            "about:blank",
            "Bad Request",
            400,
            error.message,
          );
      }
    }
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to build DeFindex deposit transaction",
    );
  }
}
