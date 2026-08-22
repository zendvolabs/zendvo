"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { validateGiftPricing } from "../lib/pricing";
import { ACCESS_TOKEN_COOKIE } from "../lib/cookies";
import { db } from "../lib/db";
import { transactions, wallets } from "../lib/db/schema";
import { verifyAccessToken } from "../lib/tokens";

export interface PendingSavingsTransactionInput {
  type: "deposit" | "withdrawal";
  amount: number;
  currency: string;
  blockchainTxHash: string;
  walletId?: string;
  reference?: string;
  provider?: string;
}

/** Records an authenticated deposit or withdrawal before chain confirmation. */
export async function recordPendingSavingsTransaction(
  input: PendingSavingsTransactionInput,
) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const authPayload = accessToken ? await verifyAccessToken(accessToken) : null;

  if (!authPayload) {
    return { success: false, error: "Authentication required" };
  }

  const amount = Number(input.amount);
  const currency = input.currency?.trim().toUpperCase();
  const blockchainTxHash = input.blockchainTxHash?.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "Amount must be greater than zero" };
  }
  if (!currency) {
    return { success: false, error: "Currency is required" };
  }
  if (!blockchainTxHash) {
    return { success: false, error: "Blockchain transaction hash is required" };
  }

  let walletId = input.walletId;
  if (walletId) {
    const wallet = await db.query.wallets.findFirst({
      where: and(
        eq(wallets.id, walletId),
        eq(wallets.userId, authPayload.userId),
      ),
    });
    if (!wallet) {
      return { success: false, error: "Wallet not found" };
    }
  } else {
    const wallet = await db.query.wallets.findFirst({
      where: and(
        eq(wallets.userId, authPayload.userId),
        eq(wallets.currency, currency),
      ),
    });
    walletId = wallet?.id;
  }

  const [transaction] = await db
    .insert(transactions)
    .values({
      userId: authPayload.userId,
      walletId,
      type: input.type,
      status: "pending",
      amount,
      currency,
      blockchainTxHash,
      reference: input.reference?.trim() || null,
      provider: input.provider?.trim() || "soroban",
    })
    .returning();

  revalidatePath("/dashboard");
  return { success: true, transaction };
}

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
