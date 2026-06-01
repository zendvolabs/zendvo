import Stripe from "stripe";


export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || "sk_test_placeholder_for_build_step",
  {
    apiVersion: "2026-02-25.clover",
  }
);

export const createPaymentIntent = async (
  amount: number,
  currency: string = "usd"
) => {
  return await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency,
  });
};

export interface CheckoutSessionParams {
  giftId: string;
  amount: number;
  currency: string;
  giftDescription?: string;
  successUrl: string;
  cancelUrl: string;
}


export const createCheckoutSession = async (
  params: CheckoutSessionParams
): Promise<Stripe.Checkout.Session> => {
  const { giftId, amount, currency, giftDescription, successUrl, cancelUrl } = params;

  return await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: Math.round(amount * 100),
          product_data: {
            name: giftDescription || "Gift Payment",
            description: `Gift ID: ${giftId}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { giftId },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
};


export const verifyPayment = async (paymentIntentId: string) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe secret key is not configured");
  }

  if (!paymentIntentId) {
    throw new Error("Payment intent ID is required");
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    return {
      success: true,
      status: paymentIntent.status,
      reference: paymentIntent.id,
      amount: paymentIntent.amount / 100, 
      currency: paymentIntent.currency.toUpperCase(),
      paidAt: paymentIntent.status === "succeeded"
        ? new Date(paymentIntent.created * 1000).toISOString()
        : null,
      metadata: paymentIntent.metadata,
    };
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      throw new Error(`Payment verification failed: ${error.message}`);
    }
    throw new Error("Payment verification failed: Unknown error");
  }
};


export const isPaymentSuccessful = (status: string): boolean => {
  return status === "succeeded";
};

export interface PayoutParams {
  amount: number;
  currency: string;
  destinationAccountId?: string;
}

export const createPayout = async (params: PayoutParams) => {
  const { amount, currency, destinationAccountId } = params;
  
  if (destinationAccountId) {
    return await stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      destination: destinationAccountId,
    });
  }

  return await stripe.payouts.create({
    amount: Math.round(amount * 100),
    currency: currency.toLowerCase(),
  });
};
