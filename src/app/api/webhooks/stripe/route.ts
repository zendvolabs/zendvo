import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import Stripe from "stripe";
import { createProblemDetails } from "@/lib/api-utils";


export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("[STRIPE_WEBHOOK] STRIPE_WEBHOOK_SECRET is not configured");
      return createProblemDetails(
        "about:blank",
        "Internal Server Error",
        500,
        "Webhook secret not configured",
      );
    }

    if (!signature) {
      console.warn("[STRIPE_WEBHOOK] Missing stripe-signature header");
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Missing signature",
      );
    }

    
    const rawBody = await req.text();

    let event: Stripe.Event;

    try {
      
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      console.warn("[STRIPE_WEBHOOK] Signature verification failed:", err);
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Invalid signature",
      );
    }

    console.log(`[STRIPE_WEBHOOK] Received event: ${event.type}`);
    console.log(`[STRIPE_WEBHOOK] Handling event type: ${event.type}`);

    let result;

    if (
      event.type === "checkout.session.completed" ||
      event.type === "payment_intent.succeeded"
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessionOrIntent = event.data.object as any;
      const giftId = sessionOrIntent.metadata?.giftId;
      const paymentIntentId =
        event.type === "payment_intent.succeeded"
          ? sessionOrIntent.id
          : sessionOrIntent.payment_intent;

      console.log(
        `[STRIPE_WEBHOOK] Processing successful payment for gift: ${giftId}, reference: ${paymentIntentId}`,
      );

      if (giftId) {
        const { markGiftPaymentSuccessfulByReference } = await import(
          "@/server/services/giftStatusService"
        );
        result = await markGiftPaymentSuccessfulByReference(
          paymentIntentId || giftId,
          "stripe",
        );
        if (!result.success && !paymentIntentId) {
          
          
        }
      } else {
        console.warn("[STRIPE_WEBHOOK] No giftId found in metadata");
      }
    }

    return NextResponse.json(
      { received: true, processed: result?.success ?? false },
      { status: 200 },
    );
  } catch (error) {
    console.error("[STRIPE_WEBHOOK_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
