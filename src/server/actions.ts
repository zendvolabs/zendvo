"use server";

import { revalidatePath } from "next/cache";

export async function createGift(formData: FormData) {
  console.log("Creating gift...");

  revalidatePath("/dashboard");
  return { success: true };
}

export async function claimGift(giftId: string) {
  console.log(`Claiming gift: ${giftId}`);

  revalidatePath("/dashboard");
  return { success: true };
}
