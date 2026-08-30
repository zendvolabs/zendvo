import {
  savingsHistory,
  users,
  wallets,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
export type Transaction = any;

/**
 * Represents the result of a savings operation (deposit or withdrawal).
 */
export interface SavingsOperationResult {
  success: boolean;
  error?: string;
  savingsHistoryId?: string;
}

/**
 * Savings Service
 * Handles atomic recording of savings deposits and withdrawals with proper
 * transaction management to ensure ACID properties and prevent race conditions.
 */
export class SavingsService {
  /**
   * Records a completed deposit in savings history and updates user's savings balance.
   * Must be called within a database transaction context.
   *
   * @param tx - The database transaction context
   * @param userId - The user ID performing the deposit
   * @param amount - The deposit amount
   * @param currency - The currency code (e.g., "USDC")
   * @param transactionHash - The blockchain transaction hash
   * @param vaultContractId - The vault contract ID
   * @returns The savings history record ID if successful
   */
  static async recordDeposit(
    tx: Transaction,
    userId: string,
    amount: number,
    currency: string,
    transactionHash: string,
    vaultContractId?: string,
  ): Promise<SavingsOperationResult> {
    try {
      // Lock the user row to serialize ledger updates and prevent race conditions.
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!user) {
        return {
          success: false,
          error: `User not found: ${userId}`,
        };
      }

      // Record the deposit in savings history
      const [savingsEntry] = await tx
        .insert(savingsHistory)
        .values({
          userId,
          vaultContractId: vaultContractId || user.vaultContractId || "",
          type: "deposit",
          status: "completed",
          amount,
          currency,
          transactionHash,
          sharePrice: null,
          sharesToBurn: null,
          sharesBalance: null,
          errorMessage: null,
        })
        .returning({ id: savingsHistory.id });

      // Update user's cached savings balance
      const newSavingsBalance = (Number(user.savingsBalance) || 0) + amount;
      await tx
        .update(users)
        .set({
          savingsBalance: newSavingsBalance,
          savingsStatus: "active",
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      // Credit the wallet
      const [existingWallet] = await tx
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, userId), eq(wallets.currency, currency)))
        .limit(1);

      if (existingWallet) {
        await tx
          .update(wallets)
          .set({
            balance: (Number(existingWallet.balance) || 0) + amount,
            updatedAt: new Date(),
          })
          .where(eq(wallets.id, existingWallet.id));
      } else {
        await tx.insert(wallets).values({
          userId,
          currency,
          balance: amount,
        });
      }

      return {
        success: true,
        savingsHistoryId: savingsEntry?.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[SAVINGS_SERVICE_DEPOSIT_ERROR] ${errorMessage}`);
      return {
        success: false,
        error: `Failed to record deposit: ${errorMessage}`,
      };
    }
  }

  /**
   * Records a completed withdrawal in savings history and updates user's savings balance.
   * Must be called within a database transaction context.
   *
   * @param tx - The database transaction context
   * @param userId - The user ID performing the withdrawal
   * @param amount - The withdrawal amount
   * @param currency - The currency code (e.g., "USDC")
   * @param transactionHash - The blockchain transaction hash
   * @param vaultContractId - The vault contract ID
   * @returns The savings history record ID if successful
   */
  static async recordWithdrawal(
    tx: Transaction,
    userId: string,
    amount: number,
    currency: string,
    transactionHash: string,
    vaultContractId?: string,
  ): Promise<SavingsOperationResult> {
    try {
      // Lock the user row to serialize ledger updates and prevent race conditions.
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!user) {
        return {
          success: false,
          error: `User not found: ${userId}`,
        };
      }

      // Record the withdrawal in savings history
      const [savingsEntry] = await tx
        .insert(savingsHistory)
        .values({
          userId,
          vaultContractId: vaultContractId || user.vaultContractId || "",
          type: "withdrawal",
          status: "completed",
          amount,
          currency,
          transactionHash,
          sharePrice: null,
          sharesToBurn: null,
          sharesBalance: null,
          errorMessage: null,
        })
        .returning({ id: savingsHistory.id });

      // Update user's cached savings balance
      const newSavingsBalance = Math.max(0, (Number(user.savingsBalance) || 0) - amount);
      await tx
        .update(users)
        .set({
          savingsBalance: newSavingsBalance,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      // Debit the wallet
      const [existingWallet] = await tx
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, userId), eq(wallets.currency, currency)))
        .limit(1);

      if (existingWallet) {
        const newBalance = (Number(existingWallet.balance) || 0) - amount;
        await tx
          .update(wallets)
          .set({
            balance: newBalance,
            updatedAt: new Date(),
          })
          .where(eq(wallets.id, existingWallet.id));
      }

      return {
        success: true,
        savingsHistoryId: savingsEntry?.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[SAVINGS_SERVICE_WITHDRAWAL_ERROR] ${errorMessage}`);
      return {
        success: false,
        error: `Failed to record withdrawal: ${errorMessage}`,
      };
    }
  }

  /**
   * Records a pending savings transaction in history.
   * Used to track transactions from their submission until completion.
   *
   * @param tx - The database transaction context
   * @param userId - The user ID
   * @param type - The transaction type ("deposit" or "withdrawal")
   * @param transactionHash - The blockchain transaction hash
   * @param vaultContractId - The vault contract ID
   */
  static async recordPending(
    tx: Transaction,
    userId: string,
    type: "deposit" | "withdrawal",
    transactionHash: string,
    vaultContractId?: string,
  ): Promise<SavingsOperationResult> {
    try {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!user) {
        return {
          success: false,
          error: `User not found: ${userId}`,
        };
      }

      const [savingsEntry] = await tx
        .insert(savingsHistory)
        .values({
          userId,
          vaultContractId: vaultContractId || user.vaultContractId || "",
          type,
          status: "pending",
          amount: 0,
          currency: "USDC",
          transactionHash,
          sharePrice: null,
          sharesToBurn: null,
          sharesBalance: null,
          errorMessage: null,
        })
        .returning({ id: savingsHistory.id });

      return {
        success: true,
        savingsHistoryId: savingsEntry?.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[SAVINGS_SERVICE_PENDING_ERROR] ${errorMessage}`);
      return {
        success: false,
        error: `Failed to record pending transaction: ${errorMessage}`,
      };
    }
  }

  /**
   * Records a failed savings transaction in history.
   *
   * @param tx - The database transaction context
   * @param userId - The user ID
   * @param type - The transaction type ("deposit" or "withdrawal")
   * @param transactionHash - The blockchain transaction hash
   * @param errorMessage - The error message explaining the failure
   * @param vaultContractId - The vault contract ID
   */
  static async recordFailure(
    tx: Transaction,
    userId: string,
    type: "deposit" | "withdrawal",
    transactionHash: string,
    errorMessage: string,
    vaultContractId?: string,
  ): Promise<SavingsOperationResult> {
    try {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!user) {
        return {
          success: false,
          error: `User not found: ${userId}`,
        };
      }

      const [savingsEntry] = await tx
        .insert(savingsHistory)
        .values({
          userId,
          vaultContractId: vaultContractId || user.vaultContractId || "",
          type,
          status: "failed",
          amount: 0,
          currency: "USDC",
          transactionHash,
          sharePrice: null,
          sharesToBurn: null,
          sharesBalance: null,
          errorMessage,
        })
        .returning({ id: savingsHistory.id });

      return {
        success: true,
        savingsHistoryId: savingsEntry?.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[SAVINGS_SERVICE_FAILURE_ERROR] ${errorMessage}`);
      return {
        success: false,
        error: `Failed to record failed transaction: ${errorMessage}`,
      };
    }
  }
}
