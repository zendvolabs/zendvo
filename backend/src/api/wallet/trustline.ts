import { NextRequest, NextResponse } from "next/server";
import { TrustlineService } from "../../lib/stellar/trustline_service";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required",
      );
    }

    const { userId } = payload;

    const [user] = await db
      .select({ stellarAddress: users.stellarAddress })
      .from(users)
      .where(eq(users.id, userId));

    if (!user?.stellarAddress) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "No Stellar address registered for this account",
      );
    }

    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(
      user.stellarAddress,
    );

    return NextResponse.json({ success: true, xdr }, { status: 200 });
  } catch (error: any) {
    console.error("[WALLET_TRUSTLINE_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      error?.message || "Failed to build sponsored trustline transaction",
    );
  }
}
