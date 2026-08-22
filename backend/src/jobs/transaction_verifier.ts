import cron from "node-cron";
import { rpc } from "@stellar/stellar-sdk";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, wallets } from "@/lib/db/schema";

const DEFAULT_INTERVAL = "*/1 * * * *";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type OnChainTransactionStatus =
  | "SUCCESS"
  | "FAILED"
  | "PENDING"
  | "NOT_FOUND";

export interface PendingTransaction {
  id: string;
  userId: string;
  walletId: string | null;
  type: "deposit" | "withdrawal" | "transfer";
  amount: number;
  currency: string;
  blockchainTxHash: string;
  createdAt: Date;
}

export interface TransactionVerifierDependencies {
  listPendingTransactions: () => Promise<PendingTransaction[]>;
  getTransactionStatus: (
    transactionHash: string,
  ) => Promise<OnChainTransactionStatus>;
  completeDeposit: (transaction: PendingTransaction) => Promise<boolean>;
  completeTransaction: (transactionId: string) => Promise<void>;
  failTransaction: (transactionId: string) => Promise<void>;
  now: () => Date;
  timeoutMs: number;
}

export interface ReconciliationSummary {
  checked: number;
  completed: number;
  failed: number;
  pending: number;
  errors: number;
}

/** Returns the configured Soroban RPC endpoint for transaction checks. */
function getRpcUrl(): string {
  const rpcUrl = process.env.SOROBAN_RPC_URL || process.env.STELLAR_RPC_URL;
  if (!rpcUrl) {
    throw new Error(
      "SOROBAN_RPC_URL or STELLAR_RPC_URL must be configured for transaction verification",
    );
  }
  return rpcUrl;
}

/** Loads pending transactions that have an on-chain hash to reconcile. */
async function listPendingTransactions(): Promise<PendingTransaction[]> {
  const pendingTransactions = await db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      walletId: transactions.walletId,
      type: transactions.type,
      amount: transactions.amount,
      currency: transactions.currency,
      blockchainTxHash: transactions.blockchainTxHash,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.status, "pending"),
        isNotNull(transactions.blockchainTxHash),
      ),
    );

  return pendingTransactions.map((pendingTransaction) => ({
    ...pendingTransaction,
    blockchainTxHash: pendingTransaction.blockchainTxHash!,
  }));
}

/** Retrieves and normalizes a transaction status from Soroban RPC. */
async function getTransactionStatus(
  transactionHash: string,
): Promise<OnChainTransactionStatus> {
  const server = new rpc.Server(getRpcUrl());
  const response = await server.getTransaction(transactionHash);

  if (response.status === "SUCCESS") return "SUCCESS";
  if (response.status === "FAILED") return "FAILED";
  if (response.status === "NOT_FOUND") return "NOT_FOUND";
  return "PENDING";
}

/** Atomically credits a deposit and marks its transaction completed. */
async function completeDeposit(
  pendingTransaction: PendingTransaction,
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [lockedTransaction] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, pendingTransaction.id))
      .for("update");

    if (!lockedTransaction || lockedTransaction.status !== "pending") {
      return false;
    }

    let walletId = lockedTransaction.walletId;

    if (walletId) {
      const updatedWallets = await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} + ${lockedTransaction.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(wallets.id, walletId),
            eq(wallets.userId, lockedTransaction.userId),
          ),
        )
        .returning({ id: wallets.id });

      if (updatedWallets.length === 0) {
        throw new Error(`Wallet ${walletId} was not found for pending deposit`);
      }
    } else {
      const existingWallet = await tx.query.wallets.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.userId, lockedTransaction.userId),
            eq(table.currency, lockedTransaction.currency),
          ),
      });

      if (existingWallet) {
        walletId = existingWallet.id;
        await tx
          .update(wallets)
          .set({
            balance: sql`${wallets.balance} + ${lockedTransaction.amount}`,
            updatedAt: new Date(),
          })
          .where(eq(wallets.id, existingWallet.id));
      } else {
        const [createdWallet] = await tx
          .insert(wallets)
          .values({
            userId: lockedTransaction.userId,
            currency: lockedTransaction.currency,
            balance: lockedTransaction.amount,
          })
          .returning({ id: wallets.id });
        walletId = createdWallet.id;
      }
    }

    await tx
      .update(transactions)
      .set({
        status: "completed",
        walletId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, lockedTransaction.id));

    return true;
  });
}

/** Marks a pending non-deposit transaction as completed. */
async function completeTransaction(transactionId: string): Promise<void> {
  await db
    .update(transactions)
    .set({ status: "completed", updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.status, "pending"),
      ),
    );
}

/** Marks a pending transaction as failed. */
async function failTransaction(transactionId: string): Promise<void> {
  await db
    .update(transactions)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.status, "pending"),
      ),
    );
}

/** Builds the database and RPC dependencies used by the verifier. */
export function createTransactionVerifierDependencies(): TransactionVerifierDependencies {
  return {
    listPendingTransactions,
    getTransactionStatus,
    completeDeposit,
    completeTransaction,
    failTransaction,
    now: () => new Date(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

/** Reconciles each pending blockchain transaction and returns sweep totals. */
export async function reconcilePendingTransactions(
  dependencies: TransactionVerifierDependencies =
    createTransactionVerifierDependencies(),
): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    checked: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    errors: 0,
  };
  const pendingTransactions = await dependencies.listPendingTransactions();

  for (const pendingTransaction of pendingTransactions) {
    summary.checked += 1;

    try {
      const status = await dependencies.getTransactionStatus(
        pendingTransaction.blockchainTxHash,
      );

      if (status === "SUCCESS") {
        if (pendingTransaction.type === "deposit") {
          const completed = await dependencies.completeDeposit(pendingTransaction);
          if (completed) summary.completed += 1;
        } else {
          await dependencies.completeTransaction(pendingTransaction.id);
          summary.completed += 1;
        }
        continue;
      }

      const hasTimedOut =
        dependencies.now().getTime() - pendingTransaction.createdAt.getTime() >=
        dependencies.timeoutMs;

      if (status === "FAILED" || hasTimedOut) {
        await dependencies.failTransaction(pendingTransaction.id);
        summary.failed += 1;
      } else {
        summary.pending += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(
        `[Transaction Verifier] Failed to reconcile transaction ${pendingTransaction.id}:`,
        error,
      );
    }
  }

  return summary;
}

/** Creates an overlap-safe callback for scheduled reconciliation sweeps. */
export function createTransactionVerifierRunner(
  reconcile: () => Promise<ReconciliationSummary> =
    reconcilePendingTransactions,
) {
  let isProcessing = false;

  return async () => {
    if (isProcessing) {
      console.warn(
        "[Transaction Verifier] Previous execution is still active. Skipping tick.",
      );
      return;
    }

    isProcessing = true;
    try {
      const summary = await reconcile();
      console.log(
        `[Transaction Verifier] Checked ${summary.checked}; completed ${summary.completed}; failed ${summary.failed}; pending ${summary.pending}; errors ${summary.errors}.`,
      );
    } catch (error) {
      console.error("[Transaction Verifier] Sweep failed:", error);
    } finally {
      isProcessing = false;
    }
  };
}

/** Registers the transaction verifier with the configured cron schedule. */
export function runTransactionVerifierCron(
  schedule = process.env.TRANSACTION_VERIFIER_CRON || DEFAULT_INTERVAL,
) {
  return cron.schedule(schedule, createTransactionVerifierRunner());
}
