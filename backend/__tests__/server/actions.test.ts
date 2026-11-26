import {
  recordFailedSavingsTransaction,
  recordPendingSavingsTransaction,
  recordSuccessfulSavingsTransaction,
  type FailedSavingsTransactionInput,
  type PendingSavingsTransactionInput,
  type SuccessfulSavingsTransactionInput,
} from "../../src/server/actions";
import { savingsHistory, users } from "../../src/lib/db/schema";

const mockCookiesGet = jest.fn();
jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({ get: mockCookiesGet })),
}));

const mockRevalidatePath = jest.fn();
jest.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const mockVerifyAccessToken = jest.fn();
jest.mock("../../src/lib/tokens", () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

const mockFindTransaction = jest.fn();
const mockFindWallet = jest.fn();
const mockReturning = jest.fn();
const mockValues = jest.fn(() => ({ returning: mockReturning }));
const mockInsert = jest.fn((..._args: unknown[]) => ({ values: mockValues }));
const mockFindSavingsHistory = jest.fn();
const mockLockedUserResult = jest.fn();
const mockTxForUpdate = jest.fn(() => mockLockedUserResult());
const mockTxLockWhere = jest.fn(() => ({ for: mockTxForUpdate }));
const mockTxFrom = jest.fn(() => ({ where: mockTxLockWhere }));
const mockTxSelect = jest.fn(() => ({ from: mockTxFrom }));
const mockTxUpdateReturning = jest.fn();
const mockTxUpdateWhere = jest.fn(() => ({ returning: mockTxUpdateReturning }));
const mockTxUpdateSet = jest.fn((_values: unknown) => ({
  where: mockTxUpdateWhere,
}));
const mockTxUpdate = jest.fn(() => ({ set: mockTxUpdateSet }));
const mockTxInsertReturning = jest.fn();
const mockTxInsertValues = jest.fn(() => ({ returning: mockTxInsertReturning }));
const mockTxInsert = jest.fn(() => ({ values: mockTxInsertValues }));
const mockTxExecute = jest.fn(async () => undefined);
const mockTx = {
  select: mockTxSelect,
  query: { savingsHistory: { findFirst: mockFindSavingsHistory } },
  update: mockTxUpdate,
  insert: mockTxInsert,
  execute: mockTxExecute,
};
const mockTransaction = jest.fn(
  (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx),
);

jest.mock("../../src/lib/db", () => ({
  db: {
    query: {
      transactions: {
        findFirst: (...args: unknown[]) => mockFindTransaction(...args),
      },
      wallets: {
        findFirst: (...args: unknown[]) => mockFindWallet(...args),
      },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
    transaction: (callback: (tx: typeof mockTx) => Promise<unknown>) =>
      mockTransaction(callback),
  },
}));

const AUTH_PAYLOAD = {
  userId: "user-1",
  email: "user@example.com",
  role: "Sender",
};

const VALID_HASH = "a".repeat(64);

const validInput: PendingSavingsTransactionInput = {
  type: "deposit",
  amount: 25,
  currency: "usdc",
  blockchainTxHash: ` ${VALID_HASH} `,
};

const validFailedInput: FailedSavingsTransactionInput = {
  userId: AUTH_PAYLOAD.userId,
  type: "deposit",
  amount: 25,
  errorMessage: "Transaction timed out",
  vaultContractId: "vault-1",
  transactionHash: VALID_HASH,
};

const validSuccessfulInput: SuccessfulSavingsTransactionInput = {
  userId: AUTH_PAYLOAD.userId,
  type: "deposit",
  amount: 25,
  vaultContractId: "vault-1",
  transactionHash: VALID_HASH,
};

const lockedUser = {
  id: AUTH_PAYLOAD.userId,
  savingsBalance: 100,
};

const createdTransaction = {
  id: "tx-1",
  userId: AUTH_PAYLOAD.userId,
  status: "pending",
  amount: 25,
  currency: "USDC",
  blockchainTxHash: VALID_HASH,
};

const authenticate = (payload: unknown = AUTH_PAYLOAD) => {
  mockCookiesGet.mockReturnValue({ value: "access-token" });
  mockVerifyAccessToken.mockResolvedValue(payload);
};

describe("recordFailedSavingsTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLockedUserResult.mockReturnValue([lockedUser]);
    mockFindSavingsHistory.mockResolvedValue(null);
    mockTxInsertReturning.mockResolvedValue([
      { id: "history-1", status: "failed" },
    ]);
    mockTxUpdateReturning.mockResolvedValue([{ id: "history-1", status: "failed" }]);
  });

  it.each([
    [{ ...validFailedInput, userId: " " }, "userId is required"],
    [
      { ...validFailedInput, type: "transfer" },
      "Invalid transaction type",
    ],
    [{ ...validFailedInput, amount: 0 }, "Amount must be greater than zero"],
    [{ ...validFailedInput, errorMessage: " " }, "Error message is required"],
    [
      { ...validFailedInput, vaultContractId: " " },
      "Vault contract id is required",
    ],
    [
      { ...validFailedInput, transactionHash: "invalid" },
      "Valid 64-character blockchain transaction hash is required",
    ],
  ])("rejects invalid input", async (input, error) => {
    const result = await recordFailedSavingsTransaction(
      input as FailedSavingsTransactionInput,
    );

    expect(result).toEqual({ success: false, error });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("inserts a failed history entry without updating the user balance", async () => {
    const result = await recordFailedSavingsTransaction({
      ...validFailedInput,
      errorMessage: " Transaction timed out ",
      transactionHash: ` ${VALID_HASH} `,
    });

    expect(result).toEqual({
      success: true,
      transaction: { id: "history-1", status: "failed" },
    });
    expect(mockTxForUpdate).toHaveBeenCalledWith("update");
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockTxExecute.mock.invocationCallOrder[0]).toBeLessThan(
      mockFindSavingsHistory.mock.invocationCallOrder[0],
    );
    expect(mockTxInsertValues).toHaveBeenCalledWith({
      userId: validFailedInput.userId,
      vaultContractId: validFailedInput.vaultContractId,
      type: validFailedInput.type,
      status: "failed",
      amount: validFailedInput.amount,
      currency: "USDC",
      transactionHash: VALID_HASH,
      errorMessage: "Transaction timed out",
    });
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("updates a matching pending history entry to failed", async () => {
    mockFindSavingsHistory.mockResolvedValue({
      id: "history-1",
      userId: validFailedInput.userId,
      status: "pending",
    });

    await recordFailedSavingsTransaction(validFailedInput);

    expect(mockTxUpdateSet).toHaveBeenCalledWith({
      status: "failed",
      errorMessage: validFailedInput.errorMessage,
      updatedAt: expect.any(Date),
    });
    expect(mockTxUpdate).toHaveBeenCalledWith(savingsHistory);
    expect(mockTxUpdate).not.toHaveBeenCalledWith(users);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("does not downgrade a completed history entry", async () => {
    mockFindSavingsHistory.mockResolvedValue({
      id: "history-1",
      userId: validFailedInput.userId,
      status: "completed",
    });

    const result = await recordFailedSavingsTransaction(validFailedInput);

    expect(result).toEqual({
      success: false,
      error: "Cannot mark a completed savings transaction as failed",
    });
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("does not record a failure for an unknown user", async () => {
    mockLockedUserResult.mockReturnValue([]);

    const result = await recordFailedSavingsTransaction(validFailedInput);

    expect(result).toEqual({ success: false, error: "User not found" });
    expect(mockTxInsert).not.toHaveBeenCalled();
  });
});

describe("recordSuccessfulSavingsTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLockedUserResult.mockReturnValue([lockedUser]);
  });

  it("promotes a failed record and applies the deposit exactly once", async () => {
    const failedHistory = {
      id: "history-1",
      userId: validSuccessfulInput.userId,
      status: "failed",
      amount: validSuccessfulInput.amount,
    };
    const completedHistory = { ...failedHistory, status: "completed" };
    mockFindSavingsHistory
      .mockResolvedValueOnce(failedHistory)
      .mockResolvedValueOnce(completedHistory);
    mockLockedUserResult
      .mockReturnValueOnce([lockedUser])
      .mockReturnValueOnce([{ ...lockedUser, savingsBalance: 125 }]);
    mockTxUpdateReturning
      .mockResolvedValueOnce([completedHistory])
      .mockResolvedValueOnce([{ savingsBalance: 125 }]);

    const firstResult =
      await recordSuccessfulSavingsTransaction(validSuccessfulInput);
    const secondResult =
      await recordSuccessfulSavingsTransaction(validSuccessfulInput);

    expect(firstResult).toEqual({
      success: true,
      transaction: completedHistory,
      balance: 125,
    });
    expect(secondResult).toEqual({
      success: true,
      transaction: completedHistory,
      balance: 125,
    });
    expect(mockTxExecute).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate).toHaveBeenNthCalledWith(1, savingsHistory);
    expect(mockTxUpdate).toHaveBeenNthCalledWith(2, users);
    expect(mockTxUpdateSet.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: "completed" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledTimes(2);
  });

  it("leaves an already completed record and balance unchanged", async () => {
    const completedHistory = {
      id: "history-1",
      userId: validSuccessfulInput.userId,
      status: "completed",
    };
    mockFindSavingsHistory.mockResolvedValue(completedHistory);

    const result =
      await recordSuccessfulSavingsTransaction(validSuccessfulInput);

    expect(result).toEqual({
      success: true,
      transaction: completedHistory,
      balance: lockedUser.savingsBalance,
    });
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxInsert).not.toHaveBeenCalled();
  });
});

describe("recordPendingSavingsTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindTransaction.mockResolvedValue(null);
    mockFindWallet.mockResolvedValue(null);
    mockReturning.mockResolvedValue([createdTransaction]);
  });

  it("requires an authenticated caller", async () => {
    mockCookiesGet.mockReturnValue(undefined);

    const result = await recordPendingSavingsTransaction(validInput);

    expect(result).toEqual({
      success: false,
      error: "Authentication required",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid transaction type", async () => {
    authenticate();

    const result = await recordPendingSavingsTransaction({
      ...validInput,
      type: "transfer" as PendingSavingsTransactionInput["type"],
    });

    expect(result).toEqual({
      success: false,
      error: "Invalid transaction type",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it.each([0, -5, Number.NaN])(
    "rejects a non-positive amount (%p)",
    async (amount) => {
      authenticate();

      const result = await recordPendingSavingsTransaction({
        ...validInput,
        amount,
      });

      expect(result).toEqual({
        success: false,
        error: "Amount must be greater than zero",
      });
    },
  );

  it("rejects a missing currency", async () => {
    authenticate();

    const result = await recordPendingSavingsTransaction({
      ...validInput,
      currency: "   ",
    });

    expect(result).toEqual({
      success: false,
      error: "Currency is required",
    });
  });

  it.each(["", "not-a-hash", "0".repeat(63), "0".repeat(65)])(
    "rejects an invalid blockchain hash (%p)",
    async (blockchainTxHash) => {
      authenticate();

      const result = await recordPendingSavingsTransaction({
        ...validInput,
        blockchainTxHash,
      });

      expect(result).toEqual({
        success: false,
        error:
          "Valid 64-character blockchain transaction hash is required",
      });
      expect(mockInsert).not.toHaveBeenCalled();
    },
  );

  it("inserts a pending transaction and revalidates the dashboard", async () => {
    authenticate();

    const result = await recordPendingSavingsTransaction({
      ...validInput,
      reference: "ref-1",
    });

    expect(result).toEqual({ success: true, transaction: createdTransaction });
    expect(mockValues).toHaveBeenCalledWith({
      userId: AUTH_PAYLOAD.userId,
      walletId: undefined,
      type: "deposit",
      status: "pending",
      amount: 25,
      currency: "USDC",
      blockchainTxHash: VALID_HASH,
      reference: "ref-1",
      provider: "soroban",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("attaches the authenticated user's matching wallet", async () => {
    authenticate();
    mockFindWallet.mockResolvedValue({ id: "wallet-1" });

    await recordPendingSavingsTransaction(validInput);

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "wallet-1" }),
    );
  });

  it("rejects a wallet that does not belong to the caller", async () => {
    authenticate();
    mockFindWallet.mockResolvedValue(null);

    const result = await recordPendingSavingsTransaction({
      ...validInput,
      walletId: "someone-elses-wallet",
    });

    expect(result).toEqual({ success: false, error: "Wallet not found" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("is idempotent for the same user and hash", async () => {
    authenticate();
    mockFindTransaction.mockResolvedValue(createdTransaction);

    const result = await recordPendingSavingsTransaction(validInput);

    expect(result).toEqual({ success: true, transaction: createdTransaction });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a hash already claimed by another user", async () => {
    authenticate();
    mockFindTransaction.mockResolvedValue({
      ...createdTransaction,
      userId: "user-2",
    });

    const result = await recordPendingSavingsTransaction(validInput);

    expect(result).toEqual({
      success: false,
      error: "Transaction already exists",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("resolves a concurrent insert conflict idempotently", async () => {
    authenticate();
    mockFindTransaction
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdTransaction);
    mockReturning.mockRejectedValueOnce(new Error("unique violation"));

    const result = await recordPendingSavingsTransaction(validInput);

    expect(result).toEqual({ success: true, transaction: createdTransaction });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
