import { GET } from "@/app/api/dashboard/summary/route";
import { NextRequest } from "next/server";
import { db } from "@/server/db/drizzle";

jest.mock("@/server/db/drizzle", () => ({
  db: {
    select: jest.fn(),
  },
}));

const mockDb = db as jest.Mocked<typeof db>;

function makeRequest(userId: string | null = "user-123") {
  const url = new URL("http://localhost/api/dashboard/summary");
  const req = new NextRequest(url);
  if (userId) req.headers.set("x-user-id", userId);
  return req;
}

function mockChain(result: Record<string, unknown>[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(result),
    }),
  };
}

describe("Dashboard Summary API", () => {
  afterEach(() => jest.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.detail).toBeDefined();
    expect(body.detail).toBe("Unauthorized");
  });

  test("returns 200 with summary data for authenticated user", async () => {
    (mockDb.select as jest.Mock)
      .mockReturnValueOnce(mockChain([{ balance: 150.5 }]))
      .mockReturnValueOnce(mockChain([{ totalSent: 300 }]))
      .mockReturnValueOnce(mockChain([{ totalReceived: 450.5 }]))
      .mockReturnValueOnce(mockChain([{ transactionCount: 7 }]));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      balance: 150.5,
      totalSent: 300,
      totalReceived: 450.5,
      transactionCount: 7,
    });
  });

  test("returns zero values when user has no wallet or gifts", async () => {
    (mockDb.select as jest.Mock)
      .mockReturnValueOnce(mockChain([{ balance: 0 }]))
      .mockReturnValueOnce(mockChain([{ totalSent: 0 }]))
      .mockReturnValueOnce(mockChain([{ totalReceived: 0 }]))
      .mockReturnValueOnce(mockChain([{ transactionCount: 0 }]));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      balance: 0,
      totalSent: 0,
      totalReceived: 0,
      transactionCount: 0,
    });
  });

  test("returns 500 on database error", async () => {
    (mockDb.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockRejectedValue(new Error("DB failure")),
      }),
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toBeDefined();
    expect(body.detail).toBe("Internal server error");
  });
});
