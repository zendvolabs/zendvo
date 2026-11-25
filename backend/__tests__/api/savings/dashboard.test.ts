import { NextRequest } from "next/server";
import { GET } from "@/api/savings/dashboard/route";
import { db } from "@/lib/db";
import { getAuthPayload } from "@/lib/auth-session";
import {
  DefindexServiceError,
  getVaultDashboardMetrics,
} from "@/lib/services/defindex_service";

const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
      savingsHistory: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    },
  },
}));

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("@/lib/services/defindex_service", () => {
  const actual = jest.requireActual("@/lib/services/defindex_service");
  return {
    ...actual,
    getVaultDashboardMetrics: jest.fn(),
  };
});

const STELLAR_ADDRESS =
  "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN";
const VAULT_CONTRACT_ID =
  "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR";

const makeRequest = () =>
  new NextRequest("http://localhost/api/savings/dashboard", {
    method: "GET",
    headers: { authorization: "Bearer token" },
  });

describe("GET /api/savings/dashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthPayload as jest.Mock).mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      role: "user",
    });
    mockFindFirst.mockResolvedValue({
      id: "user-1",
      stellarAddress: STELLAR_ADDRESS,
      vaultContractId: VAULT_CONTRACT_ID,
    });
    mockFindMany.mockResolvedValue([
      {
        id: "history-1",
        vaultContractId: VAULT_CONTRACT_ID,
        type: "deposit",
        status: "completed",
        amount: 100,
        currency: "USDC",
        transactionHash: "hash-1",
        sharePrice: 1.02,
        sharesBalance: 98.04,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "history-2",
        vaultContractId: VAULT_CONTRACT_ID,
        type: "yield_claim",
        status: "completed",
        amount: 2,
        currency: "USDC",
        transactionHash: "hash-2",
        sharePrice: 1.05,
        sharesBalance: 98.04,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ]);
    (getVaultDashboardMetrics as jest.Mock).mockResolvedValue({
      vaultBalance: 102.94,
      shareBalance: 98.04,
      sharePrice: 1.05,
      apy: { rate: 6.12, formatted: "6.12%" },
    });
  });

  it("returns 401 when the request is unauthenticated", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue(null);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.title).toBe("Unauthorized");
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the authenticated user does not exist", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const res = await GET(makeRequest());

    expect(res.status).toBe(404);
  });

  it("returns 400 when the user has no Stellar address", async () => {
    mockFindFirst.mockResolvedValue({
      id: "user-1",
      stellarAddress: null,
      vaultContractId: VAULT_CONTRACT_ID,
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
  });

  it("returns 503 when no vault is configured", async () => {
    mockFindFirst.mockResolvedValue({
      id: "user-1",
      stellarAddress: STELLAR_ADDRESS,
      vaultContractId: null,
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
    expect(getVaultDashboardMetrics).not.toHaveBeenCalled();
  });

  it("returns dashboard metrics and recent savings transactions", async () => {
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.vaultBalance).toBe(102.94);
    expect(json.shareBalance).toBe(98.04);
    expect(json.sharePrice).toBe(1.05);
    expect(json.apy).toEqual({ rate: 6.12, formatted: "6.12%" });
    expect(json.data).toEqual({
      vaultBalance: 102.94,
      shareBalance: 98.04,
      sharePrice: 1.05,
      apy: { rate: 6.12, formatted: "6.12%" },
      transactions: expect.any(Array),
    });
    expect(json.transactions).toHaveLength(2);
    expect(json.transactions[0]).toEqual({
      id: "history-1",
      type: "deposit",
      status: "completed",
      amount: 100,
      currency: "USDC",
      transactionHash: "hash-1",
      sharePrice: 1.02,
      sharesBalance: 98.04,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(getVaultDashboardMetrics).toHaveBeenCalledWith({
      vaultAddress: VAULT_CONTRACT_ID,
      stellarAddress: STELLAR_ADDRESS,
      sharePriceHistory: [
        { sharePrice: 1.02, recordedAt: new Date("2026-01-01T00:00:00.000Z") },
        { sharePrice: 1.05, recordedAt: new Date("2026-07-01T00:00:00.000Z") },
      ],
    });
  });

  it("maps a DeFindex service failure to a problem response", async () => {
    (getVaultDashboardMetrics as jest.Mock).mockRejectedValue(
      new DefindexServiceError("DeFindex is unavailable.", 502, "UPSTREAM_ERROR"),
    );

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.title).toBe("Bad Gateway");
    expect(json.detail).toBe("DeFindex is unavailable.");
  });

  it("returns 500 for unexpected failures without leaking details", async () => {
    (getVaultDashboardMetrics as jest.Mock).mockRejectedValue(new Error("boom"));

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.detail).toBe("Failed to retrieve the savings dashboard.");
  });
});
