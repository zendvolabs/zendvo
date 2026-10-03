import { NextRequest, NextResponse } from "next/server";
import {
  DefindexService,
  DefindexServiceError,
} from "@/lib/services/defindex_service";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { savingsHistory } from "@/lib/db/schema";
import {
  TelemetryService,
  extractTraceId,
} from "@/lib/services/telemetry_service";

// Maximum value for signed 128-bit integer (Soroban/i128 limit)
const MAX_I128 = (1n << 127n) - 1n;

export async function POST(request: NextRequest) {
  const traceId = extractTraceId(request);
  const elapsedTimer = TelemetryService.startTimer();
  let currentUserId: string | undefined;
  let requestedAddress: string | undefined;
  let requestedAmount: string | undefined;

  try {
    // 1. Authenticate user
    const payload = await getAuthPayload(request);
    if (!payload) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        transactionType: "withdrawal",
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

    TelemetryService.logXdrGenerationStart({
      traceId,
      userId,
      transactionType: "withdrawal",
      currency: "USDC",
    });

    // 2. Parse request body with stream limit check
    const limit = 10 * 1024; // 10KB limit
    let body: unknown = {};

    if (request.body) {
      try {
        const reader = request.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            totalBytes += value.length;
            if (totalBytes > limit) {
              return createProblemDetails(
                "about:blank",
                "Payload Too Large",
                413,
                "Request body exceeds the maximum allowed size of 10KB.",
              );
            }
            chunks.push(value);
          }
        }

        const combined = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const text = new TextDecoder().decode(combined);
        if (text.trim()) {
          try {
            body = JSON.parse(text);
          } catch {
            return createProblemDetails(
              "about:blank",
              "Bad Request",
              400,
              "Invalid JSON payload",
            );
          }
        }
      } catch (streamError) {
        return createProblemDetails(
          "about:blank",
          "Bad Request",
          400,
          "Error reading request stream",
        );
      }
    }

    const { userAddress, amount } =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as { userAddress?: unknown; amount?: unknown })
        : {};

    if (typeof userAddress === "string") {
      requestedAddress = userAddress.trim();
    }
    if (typeof amount === "string") {
      requestedAmount = amount.trim();
    }

    // 3. Validate userAddress
    if (typeof userAddress !== "string") {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "withdrawal",
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "userAddress is required and must be a string",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "userAddress is required and must be a string",
      );
    }

    const trimmedAddress = userAddress.trim();
    if (!trimmedAddress) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "withdrawal",
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "userAddress is required and cannot be empty",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "userAddress is required and cannot be empty",
      );
    }

    if (!StrKey.isValidEd25519PublicKey(trimmedAddress)) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "withdrawal",
        stellarAddress: trimmedAddress,
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "Invalid Stellar public key format",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid Stellar public key format",
      );
    }

    // 4. Validate amount
    if (typeof amount !== "string") {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "withdrawal",
        stellarAddress: trimmedAddress,
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "amount is required and must be a string representation of the withdrawal amount in smallest units",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "amount is required and must be a string representation of the withdrawal amount in smallest units",
      );
    }

    const trimmedAmount = amount.trim();
    if (!trimmedAmount) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "withdrawal",
        stellarAddress: trimmedAddress,
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "amount is required and cannot be empty",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "amount is required and cannot be empty",
      );
    }

    // Must be a positive integer (digits only)
    if (!/^\d+$/.test(trimmedAmount)) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "withdrawal",
        amount: trimmedAmount,
        stellarAddress: trimmedAddress,
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "amount must be a valid positive integer in smallest units",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "amount must be a valid positive integer in smallest units",
      );
    }

    let amountBigInt: bigint;
    try {
      amountBigInt = BigInt(trimmedAmount);
    } catch {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "withdrawal",
        amount: trimmedAmount,
        stellarAddress: trimmedAddress,
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "amount is malformed",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "amount is malformed",
      );
    }

    if (amountBigInt <= 0n) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "withdrawal",
        amount: trimmedAmount,
        stellarAddress: trimmedAddress,
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "amount must be greater than zero",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "amount must be greater than zero",
      );
    }

    if (amountBigInt > MAX_I128) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "withdrawal",
        amount: trimmedAmount,
        stellarAddress: trimmedAddress,
        currency: "USDC",
        durationMs: elapsedTimer(),
        errorCode: 400,
        error: "amount is too large to be safely represented as a 128-bit signed integer",
      });
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "amount is too large to be safely represented as a 128-bit signed integer",
      );
    }

    // 5. Invoke DeFindex parameter calculation
    const result = await DefindexService.calculateWithdrawalParams(
      trimmedAddress,
      trimmedAmount,
    );

    if (currentUserId) {
      try {
        await db.insert(savingsHistory).values({
          userId: currentUserId,
          vaultContractId: result.contractId,
          type: "withdrawal",
          status: "pending",
          amount: Number(trimmedAmount) || Number(result.amount),
          currency: "USDC",
          transactionHash: result.txHash,
          sharesToBurn: result.sharesToBurn ? Number(result.sharesToBurn) : null,
          sharePrice: result.sharePrice ? Number(result.sharePrice) : null,
          sharesBalance: result.userBalance ? Number(result.userBalance) : null,
        });
      } catch (dbError) {
        console.error("[SAVINGS_HISTORY_WITHDRAW_INSERT_ERROR]", dbError);
      }
    }

    TelemetryService.logXdrGenerationSuccess({
      traceId,
      userId: currentUserId,
      transactionType: "withdrawal",
      amount: trimmedAmount,
      currency: "USDC",
      stellarAddress: trimmedAddress,
      txHash: result.txHash,
      durationMs: elapsedTimer(),
    });

    // 6. Return mapped response
    return NextResponse.json(
      {
        success: true,
        unsignedXdr: result.unsignedXdr,
        expectedUsdcAssets: result.expectedAssets,
        minimumOutputs: result.minAmountsOut,
        estimatedTransactionHash: result.txHash,
        sharesToBurn: result.sharesToBurn,
        sharePrice: result.sharePrice,
        userBalance: result.userBalance,
        totalManagedFunds: result.totalManagedFunds,
        totalSupply: result.totalSupply,
        contractId: result.contractId,
        userAddress: result.userAddress,
        amount: result.amount,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[WALLET_WITHDRAW_ERROR]", error);

    const errorCode =
      error instanceof DefindexServiceError
        ? error.kind.toUpperCase()
        : "INTERNAL_ERROR";

    TelemetryService.logXdrGenerationFailure({
      traceId,
      userId: currentUserId,
      transactionType: "withdrawal",
      amount: requestedAmount,
      currency: "USDC",
      stellarAddress: requestedAddress,
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
      "Failed to calculate withdrawal parameters",
    );
  }
}
