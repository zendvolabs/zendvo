import Stripe from "stripe";

/**
 * Stripe client configuration for gift creation payments.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia" as any,
});

export const createPaymentIntent = async (
  amount: number,
  currency: string = "usd"
) => {
  return await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency,
  });
};
