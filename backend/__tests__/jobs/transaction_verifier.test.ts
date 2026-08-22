import {
  createTransactionVerifierRunner,
  PendingTransaction,
  TransactionVerifierDependencies,
  reconcilePendingTransactions,
} from "@/jobs/transaction_verifier";

const transaction: PendingTransaction = {
  id: "transaction-1",
  userId: "user-1",
  walletId: "wallet-1",
  type: "deposit",
  amount: 25,
  currency: "USDC",
  blockchainTxHash: "abc123",
  createdAt: new Date("2026-08-21T10:00:00.000Z"),
};

/** Creates mocked verifier dependencies for reconciliation tests. */
function createDependencies(
  overrides: Partial<TransactionVerifierDependencies> = {},
): TransactionVerifierDependencies {
  return {
    listPendingTransactions: jest.fn().mockResolvedValue([transaction]),
    getTransactionStatus: jest.fn().mockResolvedValue("PENDING"),
    completeDeposit: jest.fn().mockResolvedValue(true),
    completeTransaction: jest.fn().mockResolvedValue(undefined),
    failTransaction: jest.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-08-21T10:02:00.000Z"),
    timeoutMs: 5 * 60 * 1000,
    ...overrides,
  };
}

describe("reconcilePendingTransactions", () => {
  it("credits and completes a successful deposit", async () => {
    const dependencies = createDependencies({
      getTransactionStatus: jest.fn().mockResolvedValue("SUCCESS"),
    });

    const summary = await reconcilePendingTransactions(dependencies);

    expect(dependencies.completeDeposit).toHaveBeenCalledWith(transaction);
    expect(dependencies.completeTransaction).not.toHaveBeenCalled();
    expect(summary).toEqual({
      checked: 1,
      completed: 1,
      failed: 0,
      pending: 0,
      errors: 0,
    });
  });

  it("completes a successful withdrawal without crediting a wallet", async () => {
    const withdrawal = { ...transaction, type: "withdrawal" as const };
    const dependencies = createDependencies({
      listPendingTransactions: jest.fn().mockResolvedValue([withdrawal]),
      getTransactionStatus: jest.fn().mockResolvedValue("SUCCESS"),
    });

    await reconcilePendingTransactions(dependencies);

    expect(dependencies.completeTransaction).toHaveBeenCalledWith(withdrawal.id);
    expect(dependencies.completeDeposit).not.toHaveBeenCalled();
  });

  it("marks an on-chain failure as failed", async () => {
    const dependencies = createDependencies({
      getTransactionStatus: jest.fn().mockResolvedValue("FAILED"),
    });

    const summary = await reconcilePendingTransactions(dependencies);

    expect(dependencies.failTransaction).toHaveBeenCalledWith(transaction.id);
    expect(summary.failed).toBe(1);
  });

  it("marks unresolved transactions as failed after the timeout", async () => {
    const dependencies = createDependencies({
      getTransactionStatus: jest.fn().mockResolvedValue("NOT_FOUND"),
      now: () => new Date("2026-08-21T10:05:00.000Z"),
    });

    const summary = await reconcilePendingTransactions(dependencies);

    expect(dependencies.failTransaction).toHaveBeenCalledWith(transaction.id);
    expect(summary.failed).toBe(1);
  });

  it("leaves recent unresolved transactions pending", async () => {
    const dependencies = createDependencies();

    const summary = await reconcilePendingTransactions(dependencies);

    expect(dependencies.failTransaction).not.toHaveBeenCalled();
    expect(summary.pending).toBe(1);
  });

  it("isolates RPC errors and continues processing the batch", async () => {
    const secondTransaction = { ...transaction, id: "transaction-2" };
    const getTransactionStatus = jest
      .fn()
      .mockRejectedValueOnce(new Error("RPC unavailable"))
      .mockResolvedValueOnce("FAILED");
    const dependencies = createDependencies({
      listPendingTransactions: jest
        .fn()
        .mockResolvedValue([transaction, secondTransaction]),
      getTransactionStatus,
    });
    const consoleError = jest.spyOn(console, "error").mockImplementation();

    const summary = await reconcilePendingTransactions(dependencies);

    expect(dependencies.failTransaction).toHaveBeenCalledWith(
      secondTransaction.id,
    );
    expect(summary).toEqual({
      checked: 2,
      completed: 0,
      failed: 1,
      pending: 0,
      errors: 1,
    });
    consoleError.mockRestore();
  });

  it("does not count an already reconciled deposit twice", async () => {
    const dependencies = createDependencies({
      getTransactionStatus: jest.fn().mockResolvedValue("SUCCESS"),
      completeDeposit: jest.fn().mockResolvedValue(false),
    });

    const summary = await reconcilePendingTransactions(dependencies);

    expect(summary.completed).toBe(0);
  });

  it("skips an overlapping scheduled execution", async () => {
    let resolveSweep: ((summary: Awaited<ReturnType<typeof reconcilePendingTransactions>>) => void) | undefined;
    const reconcile = jest.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof reconcilePendingTransactions>>>(
          (resolve) => {
            resolveSweep = resolve;
          },
        ),
    );
    const runner = createTransactionVerifierRunner(reconcile);
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation();
    const consoleLog = jest.spyOn(console, "log").mockImplementation();

    const firstRun = runner();
    await runner();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      "[Transaction Verifier] Previous execution is still active. Skipping tick.",
    );

    resolveSweep?.({
      checked: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      errors: 0,
    });
    await firstRun;
    consoleWarn.mockRestore();
    consoleLog.mockRestore();
  });
});
