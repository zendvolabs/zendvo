import {
  recordPendingSavingsTransaction,
  type PendingSavingsTransactionInput,
} from "../../src/server/actions";

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
