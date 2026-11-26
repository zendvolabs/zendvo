import { NextRequest } from "next/server";
import { getAuthPayload } from "@/lib/auth-session";

const orderByMock = jest.fn();
const whereMock = jest.fn(() => ({ orderBy: orderByMock }));
const fromMock = jest.fn(() => ({ where: whereMock }));
const selectMock = jest.fn((_cols?: unknown) => ({ from: fromMock }));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn(() => ({})),
  desc: jest.fn(() => ({})),
}));

jest.mock("@/lib/db", () => ({ db: { select: selectMock } }));

jest.mock("@/lib/db/schema", () => ({
  bankAccounts: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

jest.mock("@/lib/auth-session", () => ({ getAuthPayload: jest.fn() }));

import { GET } from "@/api/wallet/banks/route";

const makeRequest = () =>
  new NextRequest("http://localhost/api/wallet/banks", { method: "GET" });

describe("GET /api/wallet/banks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthPayload as jest.Mock).mockResolvedValue({ userId: "user-1" });
  });

  it("returns 401 when unauthenticated", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns masked accounts without sensitive columns", async () => {
    orderByMock.mockResolvedValue([
      {
        id: "b1",
        bankName: "GTBank",
        accountName: "Jane Doe",
        accountNumberLast4: "6789",
        country: "NG",
        currency: "NGN",
        routingNumber: null,
        sortCode: null,
        bankCode: "058",
        swiftBic: null,
        isDefault: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({
      id: "b1",
      accountNumberLast4: "6789",
      maskedAccountNumber: "****6789",
      isDefault: true,
    });

    const selected = Object.keys(selectMock.mock.calls[0][0] as object);
    for (const secret of [
      "accountNumberCiphertext",
      "accountNumberIv",
      "accountNumberAuthTag",
      "accountNumberFingerprint",
    ]) {
      expect(selected).not.toContain(secret);
      expect(body.accounts[0]).not.toHaveProperty(secret);
    }
  });

  it("returns an empty list when the user has no accounts", async () => {
    orderByMock.mockResolvedValue([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).accounts).toEqual([]);
  });

  it("returns 500 on database failure", async () => {
    orderByMock.mockRejectedValue(new Error("db down"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
