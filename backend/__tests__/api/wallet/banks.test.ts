import { NextRequest } from "next/server";
import { POST } from "../../../src/api/wallet/banks/route";
import { getAuthPayload } from "../../../src/lib/auth-session";
import {
  decryptAccountNumber,
  encryptAccountNumber,
  fingerprintAccountNumber,
} from "../../../src/lib/bank-encryption";

jest.mock("../../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("../../../src/lib/db", () => {
  const returning = jest.fn();
  const values = jest.fn().mockReturnValue({ returning });
  const insert = jest.fn().mockReturnValue({ values });
  const findFirst = jest.fn();
  return {
    db: { insert, query: { bankAccounts: { findFirst } } },
    __mock: { returning, values, insert, findFirst },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __mock } = require("../../../src/lib/db");

const ENC_KEY = "a".repeat(64);
const FP_KEY = "b".repeat(64);

const validBody = {
  bankName: "Access Bank",
  accountName: "Ada Lovelace",
  accountNumber: "0123456789",
  country: "ng",
  currency: "ngn",
  swiftBic: "abngngla",
  bankCode: "044",
};

function makeRequest(body: unknown, raw = false) {
  return new NextRequest("http://localhost:3000/api/wallet/banks", {
    method: "POST",
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe("POST /api/wallet/banks", () => {
  const mockAuth = getAuthPayload as jest.Mock;
  const originalEnv = { ...process.env };
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY = ENC_KEY;
    process.env.BANK_ACCOUNT_FINGERPRINT_KEY = FP_KEY;
    delete process.env.BANK_ACCOUNT_ENCRYPTION_KEY_VERSION;
    mockAuth.mockResolvedValue({ userId: "user-1" });
    __mock.findFirst.mockResolvedValue(undefined);
    __mock.values.mockReturnValue({ returning: __mock.returning });
    __mock.returning.mockImplementation(async () => [
      {
        id: "acct-1",
        ...__mock.values.mock.calls[0][0],
        isDefault: false,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ]);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    expect(__mock.insert).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await POST(makeRequest("{not json", true));
    expect(res.status).toBe(400);
  });

  it.each([
    ["missing bankName", { bankName: undefined }],
    ["empty accountName", { accountName: " " }],
    ["short accountNumber", { accountNumber: "12" }],
    ["non-alphanumeric accountNumber", { accountNumber: "12345; DROP" }],
    ["bad country", { country: "NGA" }],
    ["bad currency", { currency: "NG" }],
    ["bad swiftBic", { swiftBic: "123" }],
    ["bad sortCode", { sortCode: "12" }],
  ])("returns 400 for %s without echoing the account number", async (_name, patch) => {
    const res = await POST(makeRequest({ ...validBody, ...patch }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("0123456789");
    expect(__mock.insert).not.toHaveBeenCalled();
  });

  it("creates the account: encrypted at rest, last4 stored, secrets never returned", async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(201);

    const stored = __mock.values.mock.calls[0][0];
    expect(stored.userId).toBe("user-1");
    expect(stored.accountNumberLast4).toBe("6789");
    expect(stored.accountNumberKeyVersion).toBe(1);
    expect(stored.accountNumberFingerprint).toBe(
      fingerprintAccountNumber("0123456789"),
    );
    expect(stored.country).toBe("NG");
    expect(stored.currency).toBe("NGN");
    expect(stored.swiftBic).toBe("ABNGNGLA");
    expect(JSON.stringify(stored)).not.toContain("0123456789");
    expect(
      decryptAccountNumber({
        ciphertext: stored.accountNumberCiphertext,
        iv: stored.accountNumberIv,
        authTag: stored.accountNumberAuthTag,
      }),
    ).toBe("0123456789");

    const text = JSON.stringify(await res.json());
    expect(text).toContain("6789");
    expect(text).not.toContain("0123456789");
    expect(text).not.toMatch(/ciphertext|authTag|"iv"|fingerprint/i);
  });

  it("uses a fresh IV per encryption", async () => {
    await POST(makeRequest(validBody));
    await POST(makeRequest(validBody));
    const [a, b] = __mock.values.mock.calls.map((c: unknown[]) => c[0] as any);
    expect(a.accountNumberIv).not.toBe(b.accountNumberIv);
    expect(a.accountNumberCiphertext).not.toBe(b.accountNumberCiphertext);
  });

  it("records the configured key version", async () => {
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY_VERSION = "3";
    await POST(makeRequest(validBody));
    expect(__mock.values.mock.calls[0][0].accountNumberKeyVersion).toBe(3);
  });

  it("treats formatting differences as the same account (409 on duplicate)", async () => {
    __mock.findFirst.mockResolvedValue({ id: "acct-0" });
    const res = await POST(
      makeRequest({ ...validBody, accountNumber: "0123 4567-89" }),
    );
    expect(res.status).toBe(409);
    expect(__mock.insert).not.toHaveBeenCalled();
  });

  it("returns 409 when a concurrent insert hits the unique constraint", async () => {
    __mock.returning.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "23505" }),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
  });

  it("returns 500 and stores nothing when keys are not configured", async () => {
    delete process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    expect(__mock.insert).not.toHaveBeenCalled();
  });

  it("returns 500 without leaking details on unexpected DB errors", async () => {
    __mock.returning.mockRejectedValue(new Error("connection string secret"));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("bank-encryption", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY = ENC_KEY;
    process.env.BANK_ACCOUNT_FINGERPRINT_KEY = FP_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("fingerprint is deterministic, normalized and keyed", () => {
    const a = fingerprintAccountNumber("0123456789");
    expect(fingerprintAccountNumber("0123 4567-89")).toBe(a);
    process.env.BANK_ACCOUNT_FINGERPRINT_KEY = "c".repeat(64);
    expect(fingerprintAccountNumber("0123456789")).not.toBe(a);
  });

  it("rejects tampered ciphertext (GCM auth)", () => {
    const enc = encryptAccountNumber("0123456789");
    const bad = Buffer.from(enc.ciphertext, "base64");
    bad[0] ^= 1;
    expect(() =>
      decryptAccountNumber({ ...enc, ciphertext: bad.toString("base64") }),
    ).toThrow();
  });

  it("rejects short keys", () => {
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY = "abcd";
    expect(() => encryptAccountNumber("0123456789")).toThrow(/32 bytes/);
  });
});
