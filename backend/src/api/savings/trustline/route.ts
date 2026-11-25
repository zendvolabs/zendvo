import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

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

// Trustline envelopes are cheap to build and users usually need one per vault.
const TRUSTLINE_RATE_LIMIT = 20;
const TRUSTLINE_RATE_WINDOW_MS = 60_000;

const trustlineRequestSchema = z.object({
  vaultContractId: z.string().trim().min(1, "vaultContractId is required."),
});

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
        "Authentication is required to create a savings trustline.",
      );
    }

    // --- Rate limiting (keyed per authenticated user) ---
    const rateLimitStatus = consumeRateLimit(
      `savings-trustline:${payload.userId}`,
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

    // --- Input extraction & validation ---
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Request body must be valid JSON.",
      );
    }

    const parsed = trustlineRequestSchema.safeParse(body);
    if (!parsed.success) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Provide a non-empty 'vaultContractId'.",
      );
    }

    const { vaultContractId } = parsed.data;
    if (!StrKey.isValidContract(vaultContractId)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid 'vaultContractId'. Expected a Stellar contract id (C...).",
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
        "No registered Stellar address was found for this account.",
      );
    }

    // --- Build the sponsored trustline envelope ---
    TelemetryService.logXdrGenerationStart({
      traceId,
      userId: payload.userId,
      transactionType: "trustline",
      stellarAddress: user.stellarAddress,
      metadata: { vaultContractId },
    });

    const result = await new TrustlineService().buildSponsoredTrustline({
      vaultContractId,
      stellarAddress: user.stellarAddress,
    });

    TelemetryService.logXdrGenerationSuccess({
      traceId,
      userId: payload.userId,
      transactionType: "trustline",
      stellarAddress: user.stellarAddress,
      currency: result.asset.code,
      metadata: {
        vaultContractId,
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
          vaultContractId: result.vaultContractId,
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
        metadata: { vaultContractId: (error as { vaultContractId?: string }).vaultContractId },
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
    });

    console.error("[SAVINGS_TRUSTLINE_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to create the savings trustline.",
    );
  }
}
