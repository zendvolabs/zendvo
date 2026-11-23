import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { NextRequest } from "next/server";
import { POST } from "../../src/api/transactions/submit";
import { getAuthPayload } from "../../src/lib/auth-session";
import {
  SubmissionError,
  submissionService,
} from "../../src/lib/stellar/submission_service";

jest.mock("../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

// Mock only the shared service instance; keep the real XDR parsing helpers
// so malformed-envelope handling is exercised for real.
jest.mock("../../src/lib/stellar/submission_service", () => {
  const actual = jest.requireActual(
    "../../src/lib/stellar/submission_service",
  );
  return {
    ...actual,
    submissionService: {
      submitXdrToNetwork: jest.fn(),
    },
  };
});

jest.mock("../../src/lib/db", () => {
  const mockUsers: any[] = [];
  const mockInsertValues = jest.fn().mockResolvedValue([]);
  return {
    db: {
      query: {
        users: { findFirst: jest.fn(async () => mockUsers[0] || null) },
      },
      insert: jest.fn().mockReturnValue({ values: mockInsertValues }),
    },
    __mockUsers: mockUsers,
    __mockInsertValues: mockInsertValues,
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
  const mod: any = require("../../src/lib/db");
  const { __mockUsers, __mockInsertValues } = mod;

  beforeEach(() => {
    jest.clearAllMocks();
    __mockUsers.length = 0;
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

  it("should submit the envelope, log it as pending, and return the hash", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    const source = Keypair.random();
    __mockUsers.push({ id: "user-1", stellarAddress: source.publicKey() });
    const signedXdr = buildSignedXdr(source);
    mockSubmitXdr.mockResolvedValue({
      hash: "deadbeef-hash",
      status: "pending",
      attempts: 1,
    });

    const res = await POST(makeRequest({ signedXdr }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      hash: "deadbeef-hash",
      status: "pending",
    });
    expect(mockSubmitXdr).toHaveBeenCalledWith(signedXdr);
    expect(__mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "blockchain_submission",
        status: "pending",
        blockchainTxHash: "deadbeef-hash",
      }),
    );
  });

  it("should return 502 when submission fails after retries", async () => {
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
    expect(__mockInsertValues).not.toHaveBeenCalled();
  });
});
