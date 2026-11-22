"use server";

import { revalidatePath } from "next/cache";
import { validateGiftPricing } from "@/lib/pricing";

/** Validates gift pricing and refreshes the dashboard after creation. */
export async function createGift(formData: FormData) {
  console.log("Creating gift...");

  const amount = Number(formData.get("amount") || 0);
  const processingFee = Number(formData.get("processingFee") || 0);
  const totalAmount = Number(formData.get("totalAmount") || 0);

  const validation = validateGiftPricing(amount, processingFee, totalAmount);
  if (!validation.isValid) {
    console.error("Gift creation failed validation:", validation.error);
    return { success: false, error: validation.error };
  }

  // TODO: write gift records to the database here

  revalidatePath("/dashboard");
  return { success: true };
}

/** Refreshes the dashboard after a gift claim request. */
export async function claimGift(giftId: string) {
  console.log(`Claiming gift: ${giftId}`);

  revalidatePath("/dashboard");
  return { success: true };
}
