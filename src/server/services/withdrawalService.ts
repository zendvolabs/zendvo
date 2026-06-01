import { db } from "@/lib/db";
import { wallets, bankAccounts, transactions } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createPayout } from "@/lib/stripe/client";
import crypto from "crypto";

export interface ProcessWithdrawalParams {
  userId: string;
  amount: number;
  currency: string;
  bankAccountId: string;
}

export async function processWithdrawal(params: ProcessWithdrawalParams) {
  const { userId, amount, currency, bankAccountId } = params;
  const normalizedCurrency = currency.toUpperCase();

  // Validate amount
  if (amount <= 0) {
    throw new Error("Withdrawal amount must be greater than 0");
  }

  // Find the wallet
  const wallet = await db.query.wallets.findFirst({
    where: and(eq(wallets.userId, userId), eq(wallets.currency, normalizedCurrency)),
  });

  if (!wallet) {
    throw new Error("Wallet not found for this currency");
  }

  if (wallet.balance < amount) {
    throw new Error("Insufficient balance");
  }

  // Find the bank account
  const bankAccount = await db.query.bankAccounts.findFirst({
    where: and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.userId, userId)),
  });

  if (!bankAccount) {
    throw new Error("Bank account not found or does not belong to user");
  }

  // Deduct from wallet and create pending transaction
  // Using a database transaction to ensure atomicity
  const withdrawalTx = await db.transaction(async (tx) => {
    // 1. Deduct balance
    const updatedWallet = await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(and(eq(wallets.id, wallet.id), sql`${wallets.balance} >= ${amount}`))
      .returning();

    if (updatedWallet.length === 0) {
      throw new Error("Insufficient balance or concurrency error");
    }

    // 2. Create pending transaction record
    const [transactionRecord] = await tx
      .insert(transactions)
      .values({
        userId,
        walletId: wallet.id,
        type: "withdrawal",
        status: "pending",
        amount,
        currency: normalizedCurrency,
        reference: `WD_${crypto.randomUUID()}`,
      })
      .returning();

    return transactionRecord;
  });

  try {
    // Attempt the payout via Stripe
    // If the bank account has an associated Stripe Connect ID, we would use it.
    // For now, we assume swiftBic or accountNumber holds some ID or we just trigger the payout.
    // Replace `bankAccount.accountNumber` with actual Stripe Connect destination ID if available.
    // Note: If the platform uses standard payouts to its own bank account, destinationAccountId is omitted.
    // For connected accounts, we use it. We'll pass it if applicable.
    
    // As a placeholder, we use `createPayout`
    const payoutResult = await createPayout({
      amount,
      currency,
      destinationAccountId: undefined, // Update this if you have the Connect account ID
    });

    // Update transaction provider reference
    await db
      .update(transactions)
      .set({
        provider: "stripe",
        reference: payoutResult.id,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, withdrawalTx.id));

    return {
      success: true,
      transaction: withdrawalTx,
    };
  } catch (error: any) {
    // If payout fails, we might want to refund the wallet and mark transaction as failed
    // For now, we just mark it as failed and re-throw
    await db.transaction(async (tx) => {
      // Refund the wallet
      await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

      // Mark transaction as failed
      await tx
        .update(transactions)
        .set({
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, withdrawalTx.id));
    });

    throw new Error(`Withdrawal failed: ${error.message}`);
  }
}
