import { NextRequest, NextResponse } from "next/server";
import { TrustlineService } from "../../lib/stellar/trustline_service";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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
      TelemetryService.logXdrGenerationFailure({
        traceId,
        transactionType: "trustline",
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
      userId: currentUserId,
      transactionType: "trustline",
      currency: "USDC",
    });

    const [user] = await db
      .select({ stellarAddress: users.stellarAddress })
      .from(users)
      .where(eq(users.id, userId));

    if (!user?.stellarAddress) {
      TelemetryService.logXdrGenerationFailure({
        traceId,
        userId: currentUserId,
        transactionType: "trustline",
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

    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(
      user.stellarAddress,
    );

    TelemetryService.logXdrGenerationSuccess({
      traceId,
      userId: currentUserId,
      transactionType: "trustline",
      currency: "USDC",
      stellarAddress: user.stellarAddress,
      durationMs: elapsedTimer(),
    });

    return NextResponse.json({ success: true, xdr }, { status: 200 });
  } catch (error: any) {
    console.error("[WALLET_TRUSTLINE_ERROR]", error);

    TelemetryService.logXdrGenerationFailure({
      traceId,
      userId: currentUserId,
      transactionType: "trustline",
      currency: "USDC",
      stellarAddress: userStellarAddress,
      durationMs: elapsedTimer(),
      errorCode: 500,
      error,
    });

    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      error?.message || "Failed to build sponsored trustline transaction",
    );
  }
}

