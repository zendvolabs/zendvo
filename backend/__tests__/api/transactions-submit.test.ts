import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { NextRequest } from "next/server";
import { POST } from "@/api/transactions/submit";
import { getAuthPayload } from "@/lib/auth-session";
import {
  SubmissionError,
  getEnvelopeHash,
  parseSignedXdr,
  submissionService,
} from "@/lib/stellar/submission_service";

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

// Mock only the shared service instance; keep the real XDR parsing helpers
// so malformed-envelope handling is exercised for real.
jest.mock("@/lib/stellar/submission_service", () => {
  const actual = jest.requireActual("@/lib/stellar/submission_service");
  return {
    ...actual,
    submissionService: {
      submitXdrToNetwork: jest.fn(),
    },
  };
});

// In-memory stand-in for the transactions table: the intent insert is
// conflict-safe on blockchainTxHash, and findFirst returns the stored row.
jest.mock("@/lib/db", () => {
  const mockUsers: any[] = [];
  const mockTxRows: any[] = [];
  const mockInsertValues = jest.fn((values: any) => ({
    onConflictDoNothing: jest.fn(() => ({
      returning: jest.fn(async () => {
        const existing = mockTxRows.find(
          (row) => row.blockchainTxHash === values.blockchainTxHash,
        );
        if (existing) return [];
        const row = { id: `tx-${mockTxRows.length + 1}`, ...values };
        mockTxRows.push(row);
        return [row];
      }),
    })),
  }));
  const mockUpdateSet = jest.fn(() => ({
    where: jest.fn(async () => []),
  }));
  return {
    db: {
      query: {
        users: { findFirst: jest.fn(async () => mockUsers[0] || null) },
        transactions: {
          findFirst: jest.fn(async () => mockTxRows[0] || null),
        },
      },
      insert: jest.fn().mockReturnValue({ values: mockInsertValues }),
      update: jest.fn().mockReturnValue({ set: mockUpdateSet }),
    },
    __mockUsers: mockUsers,
    __mockTxRows: mockTxRows,
    __mockInsertValues: mockInsertValues,
    __mockUpdateSet: mockUpdateSet,
  };
});

function buildSignedXdr(source: Keypair): string {
  const transaction = new TransactionBuilder(
    new Account(source.publicKey(), "1"),
    { fee: "100", networkPassphrase: Networks.TESTNET },
  )
    .addOperation(
      Operation.payment({
        destination: source.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(30)
    .build();
  transaction.sign(source);
  return transaction.toEnvelope().toXDR("base64");
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/transactions/submit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/transactions/submit", () => {
  const mockGetAuthPayload = getAuthPayload as jest.Mock;
  const mockSubmitXdr = submissionService.submitXdrToNetwork as jest.Mock;
  const mod: any = require("@/lib/db");
  const { __mockUsers, __mockTxRows, __mockInsertValues, __mockUpdateSet } =
    mod;

  beforeEach(() => {
    jest.clearAllMocks();
    __mockUsers.length = 0;
    __mockTxRows.length = 0;
  });

  it("should return 401 Unauthorized if not logged in", async () => {
    mockGetAuthPayload.mockResolvedValue(null);
    const res = await POST(makeRequest({ signedXdr: "AAAA" }));
    expect(res.status).toBe(401);
  });

  it("should return 400 Bad Request if signedXdr is missing", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("should return 400 Bad Request if signedXdr is not a valid envelope", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const res = await POST(makeRequest({ signedXdr: "not-xdr" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toMatch(/valid signed transaction envelope/i);
  });

  it("should return 404 when the user does not exist", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "missing-user" });
    const res = await POST(
      makeRequest({ signedXdr: buildSignedXdr(Keypair.random()) }),
    );
    expect(res.status).toBe(404);
  });

  it("should return 403 when the user has no registered Stellar address", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    __mockUsers.push({ id: "user-1", stellarAddress: null });
    const res = await POST(
      makeRequest({ signedXdr: buildSignedXdr(Keypair.random()) }),
    );
    expect(res.status).toBe(403);
  });

  it("should return 403 when the envelope source does not match the registered address", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const registered = Keypair.random();
    const other = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: registered.publicKey() });
    const res = await POST(
      makeRequest({ signedXdr: buildSignedXdr(other) }),
    );
    expect(res.status).toBe(403);
    expect(mockSubmitXdr).not.toHaveBeenCalled();
  });

  it("should persist the intent before the RPC call, then return the hash", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const source = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: source.publicKey() });
    const signedXdr = buildSignedXdr(source);
    const localHash = getEnvelopeHash(parseSignedXdr(signedXdr));
    mockSubmitXdr.mockResolvedValue({
      hash: localHash,
      status: "pending",
      attempts: 1,
    });

    const res = await POST(makeRequest({ signedXdr }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      hash: localHash,
      status: "pending",
    });
    expect(mockSubmitXdr).toHaveBeenCalledWith(signedXdr);
    expect(__mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "blockchain_submission",
        status: "pending",
        blockchainTxHash: localHash,
      }),
    );
    // The intent insert happens before the network call.
    expect(__mockInsertValues.mock.invocationCallOrder[0]).toBeLessThan(
      mockSubmitXdr.mock.invocationCallOrder[0],
    );
    // No reconciliation update needed: the intent already carries the hash.
    expect(__mockUpdateSet).not.toHaveBeenCalled();
  });

  it("should return 502 when submission fails after retries, leaving the intent pending", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const source = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: source.publicKey() });
    mockSubmitXdr.mockRejectedValue(
      new SubmissionError("Failed to submit", 5),
    );

    const res = await POST(
      makeRequest({ signedXdr: buildSignedXdr(source) }),
    );

    expect(res.status).toBe(502);
    // The intent row was persisted before the RPC call, so the verifier
    // can reconcile it if the envelope landed; it stays pending (no
    // failed-marking update for an unknown outcome).
    expect(__mockInsertValues).toHaveBeenCalled();
    expect(__mockUpdateSet).not.toHaveBeenCalled();
  });

  it("should mark the intent failed when the network terminally rejects the envelope", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const source = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: source.publicKey() });
    mockSubmitXdr.mockRejectedValue(
      new SubmissionError("Soroban RPC rejected the transaction: ERROR", 1, undefined, true),
    );

    const res = await POST(
      makeRequest({ signedXdr: buildSignedXdr(source) }),
    );

    expect(res.status).toBe(502);
    expect(__mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("should return the accepted hash instead of failing on a repeated submission", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const source = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: source.publicKey() });
    const signedXdr = buildSignedXdr(source);
    const localHash = getEnvelopeHash(parseSignedXdr(signedXdr));
    // An earlier attempt already recorded the intent for this envelope.
    __mockTxRows.push({
      id: "tx-existing",
      userId: "user-1",
      status: "pending",
      blockchainTxHash: localHash,
    });
    mockSubmitXdr.mockResolvedValue({
      hash: localHash,
      status: "pending",
      attempts: 1,
    });

    const res = await POST(makeRequest({ signedXdr }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      hash: localHash,
      status: "pending",
    });
    // The duplicate insert did not error; the envelope was submitted
    // again (the network dedupes it) and the accepted hash returned.
    expect(mockSubmitXdr).toHaveBeenCalledWith(signedXdr);
  });

  it("should return 403 when the existing submission belongs to another user", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const source = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: source.publicKey() });
    const signedXdr = buildSignedXdr(source);
    const localHash = getEnvelopeHash(parseSignedXdr(signedXdr));
    __mockTxRows.push({
      id: "tx-existing",
      userId: "other-user",
      status: "pending",
      blockchainTxHash: localHash,
    });

    const res = await POST(makeRequest({ signedXdr }));

    expect(res.status).toBe(403);
    expect(mockSubmitXdr).not.toHaveBeenCalled();
  });

  it("should return success without re-submitting an already completed envelope", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const source = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: source.publicKey() });
    const signedXdr = buildSignedXdr(source);
    const localHash = getEnvelopeHash(parseSignedXdr(signedXdr));
    __mockTxRows.push({
      id: "tx-existing",
      userId: "user-1",
      status: "completed",
      blockchainTxHash: localHash,
    });

    const res = await POST(makeRequest({ signedXdr }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      hash: localHash,
      status: "success",
    });
    expect(mockSubmitXdr).not.toHaveBeenCalled();
  });

  it("should re-submit a previously failed intent and reset it to pending on acceptance", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const source = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: source.publicKey() });
    const signedXdr = buildSignedXdr(source);
    const localHash = getEnvelopeHash(parseSignedXdr(signedXdr));
    __mockTxRows.push({
      id: "tx-existing",
      userId: "user-1",
      status: "failed",
      blockchainTxHash: localHash,
    });
    mockSubmitXdr.mockResolvedValue({
      hash: localHash,
      status: "pending",
      attempts: 1,
    });

    const res = await POST(makeRequest({ signedXdr }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      hash: localHash,
      status: "pending",
    });
    // The new accepted submission is a genuine state change, so the
    // failed intent is reset to pending.
    expect(__mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        blockchainTxHash: localHash,
      }),
    );
  });

  it("should reconcile the intent row when the network reports a different hash", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const source = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: source.publicKey() });
    const signedXdr = buildSignedXdr(source);
    mockSubmitXdr.mockResolvedValue({
      hash: "rpc-reported-hash",
      status: "pending",
      attempts: 1,
    });

    const res = await POST(makeRequest({ signedXdr }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hash).toBe("rpc-reported-hash");
    expect(__mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ blockchainTxHash: "rpc-reported-hash" }),
    );
  });
});
