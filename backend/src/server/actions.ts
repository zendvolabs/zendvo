"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { validateGiftPricing } from "@/lib/pricing";
import { ACCESS_TOKEN_COOKIE } from "@/lib/cookies";
import { db } from "@/lib/db";
import {
  savingsHistory,
  transactions,
  users,
  wallets,
} from "@/lib/db/schema";
import { verifyAccessToken } from "@/lib/tokens";
import { TelemetryService } from "@/lib/services/telemetry_service";

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

  if (input.type !== "deposit" && input.type !== "withdrawal") {
    return { success: false, error: "Invalid transaction type" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "Amount must be greater than zero" };
  }
  if (!currency) {
    return { success: false, error: "Currency is required" };
  }
  if (!blockchainTxHash || !/^[a-fA-F0-9]{64}$/.test(blockchainTxHash)) {
    return { success: false, error: "Valid 64-character blockchain transaction hash is required" };
  }

  const existing = await db.query.transactions.findFirst({
    where: eq(transactions.blockchainTxHash, blockchainTxHash),
  });
  if (existing) {
    if (existing.userId !== authPayload.userId) {
      return { success: false, error: "Transaction already exists" };
    }
    return { success: true, transaction: existing };
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

  let transaction;
  try {
    const [inserted] = await db
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
    transaction = inserted;
  } catch (err: unknown) {
    const existingOnConflict = await db.query.transactions.findFirst({
      where: eq(transactions.blockchainTxHash, blockchainTxHash),
    });
    if (existingOnConflict) {
      if (existingOnConflict.userId !== authPayload.userId) {
        return { success: false, error: "Transaction already exists" };
      }
      return { success: true, transaction: existingOnConflict };
    }
    throw err;
  }

  revalidatePath("/dashboard");
  return { success: true, transaction };
}

export interface SuccessfulSavingsTransactionInput {
  userId: string;
  type: "deposit" | "withdrawal";
  amount: number;
  vaultContractId: string;
  transactionHash: string;
  currency?: string;
  sharesToBurn?: number | null;
  sharePrice?: number | null;
  sharesBalance?: number | null;
}

export interface FailedSavingsTransactionInput {
  userId: string;
  type: "deposit" | "withdrawal";
  amount: number;
  vaultContractId: string;
  transactionHash?: string | null;
  currency?: string;
  errorMessage: string;
}

function validateSuccessfulSavingsInput(input: SuccessfulSavingsTransactionInput) {
  const amount = Number(input.amount);
  const transactionHash = input.transactionHash?.trim();
  const vaultContractId = input.vaultContractId?.trim();
  if (!input.userId) {
    return { error: "userId is required" as const };
  }
  if (input.type !== "deposit" && input.type !== "withdrawal") {
    return { error: "Invalid transaction type" as const };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be greater than zero" as const };
  }
  if (!vaultContractId) {
    return { error: "Vault contract id is required" as const };
  }
  if (!transactionHash || !/^[a-fA-F0-9]{64}$/.test(transactionHash)) {
    return {
      error:
        "Valid 64-character blockchain transaction hash is required" as const,
    };
  }
  return { amount, transactionHash, vaultContractId };
}

/**
 * Records a successful (on-chain confirmed) savings deposit or withdrawal.
 *
 * All writes run inside a single `db.transaction()` block:
 * 1. Lock the user's ledger row (`SELECT ... FOR UPDATE`) so concurrent
 *    deposits/withdrawals for the same user are serialized.
 * 2. Conflict check — an existing `savings_history` entry with the same
 *    `transaction_hash` is returned idempotently; a hash owned by another
 *    user aborts the transaction.
 * 3. Insert the `savings_history` entry with status `completed`.
 * 4. Update the cached `users.savings_balance` / `users.savings_status`.
 *
 * Any failure throws inside the callback, rolling the transaction back so
 * the local database never diverges from the Stellar blockchain with a
 * partial write.
 */
export async function recordSuccessfulSavingsTransaction(
  input: SuccessfulSavingsTransactionInput,
) {
  const validated = validateSuccessfulSavingsInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }
  const { amount, transactionHash, vaultContractId } = validated;
  const currency = input.currency?.trim().toUpperCase() || "USDC";

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Lock the user's ledger row to serialize concurrent savings writes.
      const [lockedUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update");
      if (!lockedUser) {
        throw new Error("User not found");
      }

      // 2. Conflict detection — idempotent replay of the same on-chain hash.
      const existing = await tx.query.savingsHistory.findFirst({
        where: eq(savingsHistory.transactionHash, transactionHash),
      });
      if (existing) {
        if (existing.userId !== input.userId) {
          throw new Error("Transaction hash already claimed by another user");
        }
        if (existing.status === "pending") {
          const [updatedHistory] = await tx
            .update(savingsHistory)
            .set({
              status: "completed",
              sharesToBurn: input.sharesToBurn ?? existing.sharesToBurn,
              sharePrice: input.sharePrice ?? existing.sharePrice,
              sharesBalance: input.sharesBalance ?? existing.sharesBalance,
              updatedAt: new Date(),
            })
            .where(eq(savingsHistory.id, existing.id))
            .returning();

          const [updatedUser] = await tx
            .update(users)
            .set({
              savingsBalance:
                input.type === "deposit"
                  ? sql`${users.savingsBalance} + ${amount}`
                  : sql`${users.savingsBalance} - ${amount}`,
              savingsStatus: "active",
              updatedAt: new Date(),
            })
            .where(eq(users.id, input.userId))
            .returning({
              savingsBalance: users.savingsBalance,
            });

          return {
            transaction: updatedHistory || existing,
            balance: updatedUser?.savingsBalance,
          };
        }
        return { transaction: existing, balance: lockedUser.savingsBalance };
      }

      // 3. Withdrawals must not overdraw the cached ledger balance.
      if (
        input.type === "withdrawal" &&
        Number(lockedUser.savingsBalance || 0) < amount
      ) {
        throw new Error("Insufficient savings balance");
      }

      // 4. Insert the history entry.
      const [inserted] = await tx
        .insert(savingsHistory)
        .values({
          userId: input.userId,
          vaultContractId,
          type: input.type,
          status: "completed",
          amount,
          currency,
          transactionHash,
          sharesToBurn: input.sharesToBurn ?? null,
          sharePrice: input.sharePrice ?? null,
          sharesBalance: input.sharesBalance ?? null,
        })
        .returning();
      if (!inserted) {
        throw new Error("Failed to insert savings history entry");
      }

      // 5. Update the cached savings balance atomically.
      const [updatedUser] = await tx
        .update(users)
        .set({
          savingsBalance:
            input.type === "deposit"
              ? sql`${users.savingsBalance} + ${amount}`
              : sql`${users.savingsBalance} - ${amount}`,
          savingsStatus: "active",
          updatedAt: new Date(),
        })
        .where(eq(users.id, input.userId))
        .returning({
          savingsBalance: users.savingsBalance,
        });
      if (!updatedUser) {
        throw new Error("Failed to update savings balance");
      }

      return { transaction: inserted, balance: updatedUser.savingsBalance };
    });

    TelemetryService.logConfirmationSuccess({
      userId: input.userId,
      transactionType: input.type,
      amount,
      currency,
      vaultContractId,
      txHash: transactionHash,
    });

    revalidatePath("/dashboard");
    return { success: true, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    TelemetryService.logConfirmationFailure({
      userId: input.userId,
      transactionType: input.type,
      amount,
      currency,
      vaultContractId,
      txHash: transactionHash,
      errorCode: "CONFIRMATION_RECORD_FAILED",
      error: err,
    });
    return { success: false, error: message };
  }
}

/**
 * Records a failed savings deposit/withdrawal without touching the cached
 * balance. Still runs inside `db.transaction()` with the user row locked so
 * the failure marker and any concurrent success cannot interleave into a
 * partial state; any error rolls the whole block back.
 */
export async function recordFailedSavingsTransaction(
  input: FailedSavingsTransactionInput,
) {
  const amount = Number(input.amount);
  const vaultContractId = input.vaultContractId?.trim();
  const transactionHash = input.transactionHash?.trim() || null;
  if (!input.userId) {
    return { success: false, error: "userId is required" };
  }
  if (input.type !== "deposit" && input.type !== "withdrawal") {
    return { success: false, error: "Invalid transaction type" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "Amount must be greater than zero" };
  }
  if (!vaultContractId) {
    return { success: false, error: "Vault contract id is required" };
  }
  if (!input.errorMessage?.trim()) {
    return { success: false, error: "Error message is required" };
  }
  if (transactionHash && !/^[a-fA-F0-9]{64}$/.test(transactionHash)) {
    return {
      success: false,
      error: "Transaction hash must be a 64-character hex string",
    };
  }
  const currency = input.currency?.trim().toUpperCase() || "USDC";

  try {
    const result = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update");
      if (!lockedUser) {
        throw new Error("User not found");
      }

      if (transactionHash) {
        const existing = await tx.query.savingsHistory.findFirst({
          where: eq(savingsHistory.transactionHash, transactionHash),
        });
        if (existing) {
          if (existing.userId !== input.userId) {
            throw new Error("Transaction hash already claimed by another user");
          }
          if (existing.status === "pending") {
            const [updatedHistory] = await tx
              .update(savingsHistory)
              .set({
                status: "failed",
                errorMessage: input.errorMessage.trim(),
                updatedAt: new Date(),
              })
              .where(eq(savingsHistory.id, existing.id))
              .returning();
            return { transaction: updatedHistory || existing };
          }
          return { transaction: existing };
        }
      }

      const [inserted] = await tx
        .insert(savingsHistory)
        .values({
          userId: input.userId,
          vaultContractId,
          type: input.type,
          status: "failed",
          amount,
          currency,
          transactionHash,
          errorMessage: input.errorMessage.trim(),
        })
        .returning();
      if (!inserted) {
        throw new Error("Failed to insert savings history entry");
      }
      return { transaction: inserted };
    });

    TelemetryService.logConfirmationFailure({
      userId: input.userId,
      transactionType: input.type,
      amount,
      currency,
      vaultContractId,
      txHash: transactionHash ?? undefined,
      errorCode: "ON_CHAIN_FAILURE",
      error: input.errorMessage.trim(),
    });

    revalidatePath("/dashboard");
    return { success: true, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    TelemetryService.logConfirmationFailure({
      userId: input.userId,
      transactionType: input.type,
      amount,
      currency,
      vaultContractId,
      txHash: transactionHash ?? undefined,
      errorCode: "CONFIRMATION_RECORD_FAILED",
      error: err,
    });
    return { success: false, error: message };
  }
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
