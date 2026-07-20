import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { gifts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { initiateStripeCheckout } from "@/server/services/paymentService";
import { createProblemDetails } from "@/lib/api-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ giftId: string }> },
) {
  try {
    const userId = request.headers.get("x-user-id");

    if (!userId) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Unauthorized",
      );
    }

    const { giftId } = await params;

    const gift = await db.query.gifts.findFirst({
      where: eq(gifts.id, giftId),
    });

    if (!gift) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "Gift not found",
      );
    }

    if (!gift.senderId || gift.senderId !== userId) {
      return createProblemDetails("about:blank", "Forbidden", 403, "Forbidden");
    }

    
    const allowedStatuses = ["otp_verified", "pending_review"];
    if (!allowedStatuses.includes(gift.status)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        `Cannot initiate checkout for gift with status: ${gift.status}`,
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    const { sessionId, url } = await initiateStripeCheckout({
      giftId,
      amount: gift.amount,
      currency: gift.currency,
      baseUrl,
    });

    return NextResponse.json({ success: true, sessionId, url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      message,
    );
  }
}
