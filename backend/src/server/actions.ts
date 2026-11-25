"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { validateGiftPricing } from "@/lib/pricing";
import { ACCESS_TOKEN_COOKIE } from "@/lib/cookies";
import { db } from "@/lib/db";
import { savingsHistory, transactions, users, wallets } from "@/lib/db/schema";
import { verifyAccessToken } from "@/lib/tokens";

const BLOCKCHAIN_TX_HASH_REGEX = /^[a-fA-F0-9]{64}$/;

async function lockSavingsTransactionHash(
  execute: (query: SQL) => Promise<unknown>,
  transactionHash: string,
) {
  await execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${transactionHash}))`,
  );
}

export interface PendingSavingsTransactionInput {
  type: "deposit" | "withdrawal";
  amount: number;
  currency: string;
  blockchainTxHash: string;
  walletId?: string;
  reference?: string;
  provider?: string;
}

/**
 * Records an authenticated deposit or withdrawal before chain confirmation.
 *
 * The entry is stored with `status = "pending"` so the UI can reflect it
 * immediately and the background verifier can reconcile it once the hash is
 * confirmed on-chain.
 */
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
  if (!blockchainTxHash || !BLOCKCHAIN_TX_HASH_REGEX.test(blockchainTxHash)) {
    return {
      success: false,
      error: "Valid 64-character blockchain transaction hash is required",
    };
  }

  // Idempotency: a hash may only ever be recorded once. Replaying the same
  // hash for the same user returns the existing row; a hash claimed by another
  // user is rejected.
  const existing = await db.query.transactions.findFirst({
    where: eq(transactions.blockchainTxHash, blockchainTxHash),
  });
  if (existing) {
    if (existing.userId !== authPayload.userId) {
      return { success: false, error: "Transaction already exists" };
    }
    return { success: true, transaction: existing };
  }

  // Resolve the wallet that owns this pending transaction, ensuring any
  // client-supplied wallet id actually belongs to the authenticated user.
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
    // A concurrent request may have inserted the same unique hash between our
    // lookup and insert. Resolve it idempotently instead of surfacing an error.
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
  if (!transactionHash || !BLOCKCHAIN_TX_HASH_REGEX.test(transactionHash)) {
    return {
      error: "Valid 64-character blockchain transaction hash is required" as const,
    };
  }

  return { amount, transactionHash, vaultContractId };
}

/**
 * Records an on-chain confirmed savings deposit or withdrawal atomically.
 *
 * The user's ledger row is locked with `FOR UPDATE` so concurrent deposits and
 * withdrawals are serialized. A matching `savings_history.transaction_hash`
 * makes the operation idempotent: a completed entry is returned unchanged, a
 * pending or failed entry is promoted to completed, and a hash claimed by
 * another user is rejected. Balance and status updates happen in the same
 * transaction so a failure rolls back every write.
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
      const [lockedUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update");

      if (!lockedUser) {
        throw new Error("User not found");
      }

      await lockSavingsTransactionHash(
        (query) => tx.execute(query),
        transactionHash,
      );

      const existing = await tx.query.savingsHistory.findFirst({
        where: eq(savingsHistory.transactionHash, transactionHash),
      });

      if (existing) {
        if (existing.userId !== input.userId) {
          throw new Error("Transaction hash already claimed by another user");
        }

        if (existing.status === "pending" || existing.status === "failed") {
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
            .returning({ savingsBalance: users.savingsBalance });

          if (!updatedUser) {
            throw new Error("Failed to update savings balance");
          }

          return {
            transaction: updatedHistory ?? existing,
            balance: updatedUser.savingsBalance,
          };
        }

        return { transaction: existing, balance: lockedUser.savingsBalance };
      }

      if (
        input.type === "withdrawal" &&
        Number(lockedUser.savingsBalance || 0) < amount
      ) {
        throw new Error("Insufficient savings balance");
      }

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
        .returning({ savingsBalance: users.savingsBalance });

      if (!updatedUser) {
        throw new Error("Failed to update savings balance");
      }

      return { transaction: inserted, balance: updatedUser.savingsBalance };
    });

    revalidatePath("/dashboard");
    return { success: true, ...result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export interface FailedSavingsTransactionInput {
  userId: string;
  type: "deposit" | "withdrawal";
  amount: number;
  errorMessage: string;
  vaultContractId: string;
  transactionHash: string;
}

function validateFailedSavingsInput(input: FailedSavingsTransactionInput) {
  const amount = Number(input.amount);
  const errorMessage = input.errorMessage?.trim();
  const transactionHash = input.transactionHash?.trim();
  const vaultContractId = input.vaultContractId?.trim();

  if (!input.userId?.trim()) {
    return { error: "userId is required" as const };
  }
  if (input.type !== "deposit" && input.type !== "withdrawal") {
    return { error: "Invalid transaction type" as const };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be greater than zero" as const };
  }
  if (!errorMessage) {
    return { error: "Error message is required" as const };
  }
  if (!vaultContractId) {
    return { error: "Vault contract id is required" as const };
  }
  if (!transactionHash || !BLOCKCHAIN_TX_HASH_REGEX.test(transactionHash)) {
    return {
      error: "Valid 64-character blockchain transaction hash is required" as const,
    };
  }

  return { amount, errorMessage, transactionHash, vaultContractId };
}

/**
 * Records a failed on-chain savings transaction without changing the user's
 * ledger balance. The user row lock serializes updates with successful
 * transaction confirmations.
 */
export async function recordFailedSavingsTransaction(
  input: FailedSavingsTransactionInput,
) {
  const validated = validateFailedSavingsInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const { amount, errorMessage, transactionHash, vaultContractId } = validated;

  try {
    const transaction = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update");

      if (!lockedUser) {
        throw new Error("User not found");
      }

      await lockSavingsTransactionHash(
        (query) => tx.execute(query),
        transactionHash,
      );

      const existing = await tx.query.savingsHistory.findFirst({
        where: eq(savingsHistory.transactionHash, transactionHash),
      });

      if (existing) {
        if (existing.userId !== input.userId) {
          throw new Error("Transaction hash already claimed by another user");
        }
        if (existing.status === "completed") {
          throw new Error("Cannot mark a completed savings transaction as failed");
        }

        const [updatedHistory] = await tx
          .update(savingsHistory)
          .set({ status: "failed", errorMessage, updatedAt: new Date() })
          .where(eq(savingsHistory.id, existing.id))
          .returning();

        if (!updatedHistory) {
          throw new Error("Failed to update savings history entry");
        }

        return updatedHistory;
      }

      const [inserted] = await tx
        .insert(savingsHistory)
        .values({
          userId: input.userId,
          vaultContractId,
          type: input.type,
          status: "failed",
          amount,
          currency: "USDC",
          transactionHash,
          errorMessage,
        })
        .returning();

      if (!inserted) {
        throw new Error("Failed to insert savings history entry");
      }

      return inserted;
    });

    revalidatePath("/dashboard");
    return { success: true, transaction };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
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
