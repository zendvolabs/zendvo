import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { GET } from "../../../src/api/wallet/transactions/route";
import { getAuthPayload } from "../../../src/lib/auth-session";
import { gifts, transactions } from "../../../src/lib/db/schema";

jest.mock("../../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

type RecordedQuery = {
  table: unknown;
  kind: "count" | "rows";
  where: unknown;
  limit?: number;
  offset?: number;
};

const mockState = {
  txCount: 0,
  txRows: [] as Array<Record<string, unknown>>,
  giftCount: 0,
  giftRows: [] as Array<Record<string, unknown>>,
  throwError: null as Error | null,
  queries: [] as RecordedQuery[],
};

jest.mock("../../../src/lib/db", () => ({
  db: {
    select: jest.fn((fields: Record<string, unknown>) => {
      const isCount = "count" in fields;
      return {
        from: jest.fn((table: unknown) => {
          const record: RecordedQuery = {
            table,
            kind: isCount ? "count" : "rows",
            where: undefined,
          };

          const resolveRows = () => {
            if (mockState.throwError) {
              return Promise.reject(mockState.throwError);
            }
            if (table === transactions) {
              return Promise.resolve(mockState.txRows);
            }
            if (table === gifts) {
              return Promise.resolve(mockState.giftRows);
            }
            return Promise.resolve([]);
          };

          interface MockChain {
            leftJoin: jest.Mock;
            where: jest.Mock;
            orderBy: jest.Mock;
            limit: jest.Mock;
            offset: jest.Mock;
          }

          const chain: MockChain = {
            leftJoin: jest.fn(() => chain),
            where: jest.fn((whereClause: unknown) => {
              record.where = whereClause;
              mockState.queries.push(record);
              if (isCount) {
                if (mockState.throwError) {
                  return Promise.reject(mockState.throwError);
                }
                const count =
                  table === transactions
                    ? mockState.txCount
                    : table === gifts
                      ? mockState.giftCount
                      : 0;
                return Promise.resolve([{ count }]);
              }
              return chain;
            }),
            orderBy: jest.fn(() => chain),
            limit: jest.fn((n: number) => {
              record.limit = n;
              return chain;
            }),
            offset: jest.fn((n: number) => {
              record.offset = n;
              return resolveRows();
            }),
          };

          return chain;
        }),
      };
    }),
  },
}));

const { db } = jest.requireMock("../../../src/lib/db");
const mockGetAuthPayload = getAuthPayload as jest.Mock;
const dialect = new PgDialect();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

function requestTransactions(query = "") {
  const url = query
    ? `http://localhost:3001/api/wallet/transactions?${query}`
    : "http://localhost:3001/api/wallet/transactions";
  const req = new NextRequest(url, {
    method: "GET",
    headers: { authorization: "Bearer valid-token" },
  });
  return GET(req);
}

describe("GET /api/wallet/transactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthPayload.mockResolvedValue({ userId: USER_ID });
    mockState.txCount = 0;
    mockState.txRows = [];
    mockState.giftCount = 0;
    mockState.giftRows = [];
    mockState.throwError = null;
    mockState.queries = [];
  });

  it("returns 401 when caller is not authenticated", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const res = await requestTransactions();

    expect(res.status).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns 400 when type query parameter is invalid", async () => {
    const res = await requestTransactions("type=invalid_type");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain("Invalid type");
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns 400 when status query parameter is invalid", async () => {
    const res = await requestTransactions("status=unknown");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain("Invalid status");
    expect(db.select).not.toHaveBeenCalled();
  });

  it("merges transactions and gifts sorted by createdAt descending with normalized fields", async () => {
    const t1 = new Date("2026-05-01T10:00:00.000Z");
    const t2 = new Date("2026-05-02T10:00:00.000Z");
    const t3 = new Date("2026-05-03T10:00:00.000Z");
    const t4 = new Date("2026-05-04T10:00:00.000Z");

    mockState.txCount = 2;
    mockState.txRows = [
      {
        id: "tx-withdrawal",
        type: "withdrawal",
        status: "submitted",
        amount: 50,
        currency: "USDC",
        reference: "wd-1",
        provider: "soroban",
        blockchainTxHash: "0xabc",
        createdAt: t3,
        updatedAt: t3,
      },
      {
        id: "tx-deposit",
        type: "deposit",
        status: "completed",
        amount: 200,
        currency: "USDC",
        reference: "dep-1",
        provider: "stripe",
        blockchainTxHash: null,
        createdAt: t1,
        updatedAt: t1,
      },
    ];

    mockState.giftCount = 2;
    mockState.giftRows = [
      {
        id: "gift-received",
        senderId: OTHER_USER_ID,
        recipientId: USER_ID,
        amount: 75,
        fee: 2,
        currency: "USDC",
        message: "Happy birthday!",
        status: "sent",
        transactionId: "gtx-1",
        paymentReference: "pay-1",
        paymentProvider: "stripe",
        blockchainTxHash: null,
        hideSender: false,
        isAnonymous: false,
        senderName: "Fallback Name",
        senderAvatar: null,
        createdAt: t4,
        updatedAt: t4,
        senderUserName: "Alice",
        senderUsername: "alice",
        senderUserAvatar: "https://cdn.example/alice.png",
        recipientUserName: "Me",
        recipientUsername: "me",
        recipientUserAvatar: null,
      },
      {
        id: "gift-sent",
        senderId: USER_ID,
        recipientId: OTHER_USER_ID,
        amount: 30,
        fee: 1,
        currency: "USDC",
        message: "Thanks!",
        status: "pending_otp",
        transactionId: "gtx-2",
        paymentReference: null,
        paymentProvider: "wallet",
        blockchainTxHash: null,
        hideSender: false,
        isAnonymous: false,
        senderName: null,
        senderAvatar: null,
        createdAt: t2,
        updatedAt: t2,
        senderUserName: "Me",
        senderUsername: "me",
        senderUserAvatar: null,
        recipientUserName: "Bob",
        recipientUsername: "bob",
        recipientUserAvatar: null,
      },
    ];

    const res = await requestTransactions("page=1&limit=10");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(4);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
    expect(body.totalPages).toBe(1);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      "gift-received",
      "tx-withdrawal",
      "gift-sent",
      "tx-deposit",
    ]);

    expect(body.items[0]).toMatchObject({
      id: "gift-received",
      source: "gift",
      type: "gift_received",
      direction: "credit",
      status: "completed",
      rawStatus: "sent",
      amount: 75,
      fee: 2,
      reference: "pay-1",
      counterparty: {
        id: OTHER_USER_ID,
        name: "Alice",
        username: "alice",
        avatarUrl: "https://cdn.example/alice.png",
      },
    });
    expect(body.items[1]).toMatchObject({
      id: "tx-withdrawal",
      source: "transaction",
      type: "withdrawal",
      direction: "debit",
      status: "pending",
      rawStatus: "submitted",
    });
    expect(body.items[2]).toMatchObject({
      id: "gift-sent",
      source: "gift",
      type: "gift_sent",
      direction: "debit",
      status: "pending",
      rawStatus: "pending_otp",
      reference: "gtx-2",
      counterparty: {
        id: OTHER_USER_ID,
        name: "Bob",
        username: "bob",
        avatarUrl: null,
      },
    });
    expect(body.items[3]).toMatchObject({
      id: "tx-deposit",
      source: "transaction",
      type: "top_up",
      direction: "credit",
      status: "completed",
      rawStatus: "completed",
    });
  });

  it("hides sender details for anonymous or hidden-sender received gifts", async () => {
    const now = new Date("2026-05-05T12:00:00.000Z");
    mockState.giftCount = 1;
    mockState.giftRows = [
      {
        id: "anon-gift",
        senderId: OTHER_USER_ID,
        recipientId: USER_ID,
        amount: 25,
        fee: 0,
        currency: "USDC",
        message: "Secret",
        status: "completed",
        transactionId: null,
        paymentReference: null,
        paymentProvider: null,
        blockchainTxHash: null,
        hideSender: true,
        isAnonymous: true,
        senderName: "Secret Sender",
        senderAvatar: "https://cdn.example/secret.png",
        createdAt: now,
        updatedAt: now,
        senderUserName: "Secret Sender",
        senderUsername: "secret",
        senderUserAvatar: "https://cdn.example/secret.png",
        recipientUserName: "Me",
        recipientUsername: "me",
        recipientUserAvatar: null,
      },
    ];

    const res = await requestTransactions("type=gift_received");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].counterparty).toBeNull();
  });

  it("queries only transactions with type=deposit when filtering by type=top_up", async () => {
    mockState.txCount = 1;
    mockState.txRows = [
      {
        id: "dep-1",
        type: "deposit",
        status: "completed",
        amount: 100,
        currency: "USDC",
        reference: null,
        provider: "stripe",
        blockchainTxHash: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ];

    const res = await requestTransactions("type=top_up&status=completed");

    expect(res.status).toBe(200);
    expect(mockState.queries.every((q) => q.table === transactions)).toBe(true);
    const rowQuery = mockState.queries.find((q) => q.kind === "rows");
    const compiled = dialect.sqlToQuery(rowQuery!.where as never);
    expect(compiled.params).toEqual([USER_ID, "deposit", "completed"]);
  });

  it("queries only transactions with type=withdrawal when filtering by type=withdrawal", async () => {
    const res = await requestTransactions("type=withdrawal&status=pending");

    expect(res.status).toBe(200);
    expect(mockState.queries.every((q) => q.table === transactions)).toBe(true);
    const rowQuery = mockState.queries.find((q) => q.kind === "rows");
    const compiled = dialect.sqlToQuery(rowQuery!.where as never);
    expect(compiled.params).toEqual([USER_ID, "withdrawal", "pending", "submitted"]);
  });

  it("queries only gifts with senderId filter when filtering by type=gift_sent", async () => {
    const res = await requestTransactions("type=gift_sent&status=failed");

    expect(res.status).toBe(200);
    expect(mockState.queries.every((q) => q.table === gifts)).toBe(true);
    const rowQuery = mockState.queries.find((q) => q.kind === "rows");
    const compiled = dialect.sqlToQuery(rowQuery!.where as never);
    expect(compiled.sql).toContain('"gifts"."sender_id" = $1');
    expect(compiled.params).toEqual([USER_ID, "failed"]);
  });

  it("paginates merged results accurately across pages and clamps limit to 100", async () => {
    mockState.txCount = 2;
    mockState.txRows = [
      {
        id: "tx-1",
        type: "deposit",
        status: "completed",
        amount: 10,
        currency: "USDC",
        reference: null,
        provider: null,
        blockchainTxHash: null,
        createdAt: new Date("2026-05-04T00:00:00.000Z"),
        updatedAt: new Date("2026-05-04T00:00:00.000Z"),
      },
      {
        id: "tx-2",
        type: "withdrawal",
        status: "completed",
        amount: 20,
        currency: "USDC",
        reference: null,
        provider: null,
        blockchainTxHash: null,
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
        updatedAt: new Date("2026-05-02T00:00:00.000Z"),
      },
    ];
    mockState.giftCount = 2;
    mockState.giftRows = [
      {
        id: "gift-1",
        senderId: USER_ID,
        recipientId: OTHER_USER_ID,
        amount: 30,
        fee: 0,
        currency: "USDC",
        message: null,
        status: "completed",
        transactionId: null,
        paymentReference: null,
        paymentProvider: null,
        blockchainTxHash: null,
        hideSender: false,
        isAnonymous: false,
        senderName: null,
        senderAvatar: null,
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
        updatedAt: new Date("2026-05-03T00:00:00.000Z"),
        senderUserName: null,
        senderUsername: null,
        senderUserAvatar: null,
        recipientUserName: null,
        recipientUsername: null,
        recipientUserAvatar: null,
      },
      {
        id: "gift-2",
        senderId: OTHER_USER_ID,
        recipientId: USER_ID,
        amount: 40,
        fee: 0,
        currency: "USDC",
        message: null,
        status: "completed",
        transactionId: null,
        paymentReference: null,
        paymentProvider: null,
        blockchainTxHash: null,
        hideSender: false,
        isAnonymous: false,
        senderName: null,
        senderAvatar: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        senderUserName: null,
        senderUsername: null,
        senderUserAvatar: null,
        recipientUserName: null,
        recipientUsername: null,
        recipientUserAvatar: null,
      },
    ];

    const page2Res = await requestTransactions("page=2&limit=2");
    expect(page2Res.status).toBe(200);
    const page2 = await page2Res.json();
    expect(page2.total).toBe(4);
    expect(page2.page).toBe(2);
    expect(page2.limit).toBe(2);
    expect(page2.totalPages).toBe(2);
    expect(page2.items.map((item: { id: string }) => item.id)).toEqual([
      "tx-2",
      "gift-2",
    ]);

    const clampedRes = await requestTransactions("page=0&limit=500");
    expect(clampedRes.status).toBe(200);
    const clamped = await clampedRes.json();
    expect(clamped.page).toBe(1);
    expect(clamped.limit).toBe(100);
  });

  it("returns 500 when the database query fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockState.throwError = new Error("db unreachable");

    const res = await requestTransactions();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toBe("Failed to retrieve wallet transactions.");
  });
});
