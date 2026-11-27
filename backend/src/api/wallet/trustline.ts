import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { StrKey } from "@stellar/stellar-sdk";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { consumeRateLimit } from "@/lib/rate-limiter";
import {
  TrustlineError,
  TrustlineService,
} from "@/lib/stellar/trustline_service";
import TelemetryService, {
  extractTraceId,
} from "@/lib/services/telemetry_service";

const TRUSTLINE_RATE_LIMIT = 10;
const TRUSTLINE_RATE_WINDOW_MS = 60_000;

function problemTitleForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 404:
      return "Not Found";
    case 429:
      return "Too Many Requests";
    case 502:
      return "Bad Gateway";
    case 503:
      return "Service Unavailable";
    default:
      return "Internal Server Error";
  }
}

/**
 * POST /api/wallet/trustline/usdc
 *
 * Builds a fee-sponsored `ChangeTrust` envelope for the platform USDC asset.
 * The sponsor account covers both the transaction fee and the trustline base
 * reserve, so the user does not need to hold XLM for the reserve entry.
 *
 * The endpoint returns an unsigned XDR envelope. The client must sign it with
 * the user's Stellar keypair and then submit it via POST /api/transactions/submit.
 *
 * Authentication: Bearer JWT (Authorization header)
 * Signature:      Ed25519 request signature (X-Signature + X-Timestamp headers,
 *                 validated by the `validateRequestSignature` middleware before
 *                 this handler is reached)
 */
export async function POST(request: NextRequest) {
  const traceId = extractTraceId(request);

  try {
    // --- Authentication ---
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication is required to create a USDC trustline.",
      );
    }

    // --- Rate limiting (per authenticated user) ---
    const rateLimitStatus = consumeRateLimit(
      `wallet-usdc-trustline:${payload.userId}`,
      TRUSTLINE_RATE_LIMIT,
      TRUSTLINE_RATE_WINDOW_MS,
    );
    if (rateLimitStatus.limited) {
      return createProblemDetails(
        "about:blank",
        "Too Many Requests",
        429,
        "Too many trustline requests. Please wait before trying again.",
      );
    }

    // --- Resolve the user's registered Stellar address ---
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
      columns: {
        id: true,
        stellarAddress: true,
      },
    });

    if (!user) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "User not found.",
      );
    }

    if (!user.stellarAddress || !StrKey.isValidEd25519PublicKey(user.stellarAddress)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "No registered Stellar address was found for this account. Register a wallet first.",
      );
    }

    // --- Build the sponsored USDC trustline envelope ---
    TelemetryService.logXdrGenerationStart({
      traceId,
      userId: payload.userId,
      transactionType: "trustline",
      stellarAddress: user.stellarAddress,
      metadata: { trustlineType: "usdc_wallet" },
    });

    const result = await new TrustlineService().buildSponsoredUsdcTrustline({
      stellarAddress: user.stellarAddress,
    });

    TelemetryService.logXdrGenerationSuccess({
      traceId,
      userId: payload.userId,
      transactionType: "trustline",
      stellarAddress: user.stellarAddress,
      currency: result.asset.code,
      metadata: {
        trustlineType: "usdc_wallet",
        sponsor: result.sponsor,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          envelopeXdr: result.envelopeXdr,
          networkPassphrase: result.networkPassphrase,
          asset: result.asset,
          sponsor: result.sponsor,
          account: result.account,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof TrustlineError) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        transactionType: "trustline",
        error,
        errorCode: error.code,
        errorMessage: error.message,
        metadata: { trustlineType: "usdc_wallet" },
      });

      return createProblemDetails(
        "about:blank",
        problemTitleForStatus(error.status),
        error.status,
        error.message,
      );
    }

    TelemetryService.logXdrGenerationFailure({
      traceId,
      transactionType: "trustline",
      error,
      metadata: { trustlineType: "usdc_wallet" },
    });

    console.error("[WALLET_USDC_TRUSTLINE_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to create the USDC trustline.",
    );
  }
}
