import { NextRequest } from "next/server";
import { GET } from "@/api/savings/dashboard/route";
import { getAuthPayload } from "@/lib/auth-session";
import { db } from "@/lib/db";
import {
  DefindexService,
  DefindexServiceError,
  type VaultBalance,
} from "@/lib/services/defindex_service";

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("@/lib/tokens", () => ({
  verifyAccessToken: jest.fn(),
}));

const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();
const mockFrom = jest.fn(() => ({
  where: mockWhere,
}));
const mockSelect = jest.fn(() => ({
  from: mockFrom,
}));

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: jest.fn(),
      },
    },
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([]),
          })),
        })),
      })),
    })),
  },
}));

jest.mock("@/lib/services/defindex_service", () => {
  const actual = jest.requireActual("@/lib/services/defindex_service");
  return {
    ...actual,
    DefindexService: {
      ...actual.DefindexService,
      getVaultBalance: jest.fn(),
      estimateApy: jest.fn(),
    },
  };
});

describe("GET /api/savings/dashboard", () => {
  const mockGetAuthPayload = getAuthPayload as jest.Mock;
  const mockFindFirst = db.query.users.findFirst as jest.Mock;
  const mockGetVaultBalance = DefindexService.getVaultBalance as jest.Mock;
  const mockEstimateApy = DefindexService.estimateApy as jest.Mock;

  const TEST_STELLAR_ADDRESS =
    "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN";
  const TEST_VAULT_CONTRACT_ID =
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBA";

  const MOCK_VAULT_BALANCE: VaultBalance = {
    userAddress: TEST_STELLAR_ADDRESS,
    contractId: TEST_VAULT_CONTRACT_ID,
    rawUserBalance: "500000000",
    userBalance: "50.0000000",
    rawSharePrice: "10500000",
    sharePrice: "1.0500000",
    rawUnderlyingUsdc: "52500000",
    underlyingUsdc: "5.2500000",
    rawTotalSupply: "10000000000",
    rawTotalManagedFunds: "10500000000",
    rpcUrl: "https://soroban-testnet.stellar.org",
    apy: {
      rate: 0.0825,
      formatted: "8.25%",
      isEstimated: true,
      methodology: "Annualized return derived from historical share price increase.",
    },
    fetchedAt: "2026-09-29T12:00:00.000Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createRequest = (url = "http://localhost/api/savings/dashboard") =>
    new NextRequest(url, { method: "GET" });

  it("returns 401 when the request is unauthenticated", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const res = await GET(createRequest());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.title).toBe("Unauthorized");
    expect(json.detail).toBe("Authentication required");
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the user record does not exist", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "non-existent-user" });
    mockFindFirst.mockResolvedValue(null);

    const res = await GET(createRequest());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.title).toBe("Not Found");
    expect(json.detail).toBe("User not found");
  });

  it("returns 400 when the user has no registered Stellar address", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-without-wallet" });
    mockFindFirst.mockResolvedValue({
      id: "user-without-wallet",
      stellarAddress: null,
      vaultContractId: null,
      savingsStatus: "inactive",
      savingsBalance: 0,
    });

    const res = await GET(createRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.title).toBe("Bad Request");
    expect(json.detail).toBe("No Stellar address registered for this account");
    expect(mockGetVaultBalance).not.toHaveBeenCalled();
  });

  it("returns 200 with formatted savings dashboard data", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindFirst.mockResolvedValue({
      id: "user-123",
      stellarAddress: TEST_STELLAR_ADDRESS,
      vaultContractId: TEST_VAULT_CONTRACT_ID,
      savingsStatus: "active",
      savingsBalance: 5.25,
    });
    mockGetVaultBalance.mockResolvedValue(MOCK_VAULT_BALANCE);

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Top-level fields compatible with SavingsDataModel:
    expect(body.balance).toBe("5.2500000");
    expect(body.apy).toBe("8.25%");

    // Aggregated dashboard details:
    expect(body.data).toBeDefined();
    expect(body.data.userAddress).toBe(TEST_STELLAR_ADDRESS);
    expect(body.data.contractId).toBe(TEST_VAULT_CONTRACT_ID);
    expect(body.data.balance).toBe("5.2500000");
    expect(body.data.formattedBalance).toBe("5.25 USDC");
    expect(body.data.underlyingUsdc).toBe("5.2500000");
    expect(body.data.userShares).toBe("50.0000000");
    expect(body.data.sharePrice).toBe("1.0500000");
    expect(body.data.savingsStatus).toBe("active");
    expect(body.data.currency).toBe("USDC");
    expect(body.data.apy).toBe("8.25%");
    expect(body.data.apyRate).toBe(0.0825);
    expect(body.data.fetchedAt).toBe("2026-09-29T12:00:00.000Z");

    expect(mockGetVaultBalance).toHaveBeenCalledWith(
      TEST_STELLAR_ADDRESS,
      TEST_VAULT_CONTRACT_ID,
      expect.objectContaining({
        skipCache: false,
      }),
    );
  });

  it("respects skipCache/refresh and vaultContractId query parameters", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindFirst.mockResolvedValue({
      id: "user-123",
      stellarAddress: TEST_STELLAR_ADDRESS,
      vaultContractId: null,
      savingsStatus: "active",
      savingsBalance: 10,
    });
    const CUSTOM_VAULT = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBCCCC";
    mockGetVaultBalance.mockResolvedValue({
      ...MOCK_VAULT_BALANCE,
      contractId: CUSTOM_VAULT,
    });

    const res = await GET(
      createRequest(
        `http://localhost/api/savings/dashboard?vaultContractId=${CUSTOM_VAULT}&refresh=true`,
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetVaultBalance).toHaveBeenCalledWith(
      TEST_STELLAR_ADDRESS,
      CUSTOM_VAULT,
      expect.objectContaining({
        skipCache: true,
      }),
    );
  });

  it("returns 400 when requested vaultContractId does not match the account's registered vault", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindFirst.mockResolvedValue({
      id: "user-123",
      stellarAddress: TEST_STELLAR_ADDRESS,
      vaultContractId: TEST_VAULT_CONTRACT_ID,
      savingsStatus: "active",
      savingsBalance: 10,
    });
    const FOREIGN_VAULT = "CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDFFFF";

    const res = await GET(
      createRequest(
        `http://localhost/api/savings/dashboard?vaultContractId=${FOREIGN_VAULT}`,
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.title).toBe("Bad Request");
    expect(json.detail).toBe(
      "Requested vault does not match the account's registered vault",
    );
    expect(mockGetVaultBalance).not.toHaveBeenCalled();
  });

  it("falls back to DefindexService.estimateApy when historical APY is null", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindFirst.mockResolvedValue({
      id: "user-123",
      stellarAddress: TEST_STELLAR_ADDRESS,
      vaultContractId: TEST_VAULT_CONTRACT_ID,
      savingsStatus: "active",
      savingsBalance: 0,
    });

    mockGetVaultBalance.mockResolvedValue({
      ...MOCK_VAULT_BALANCE,
      apy: {
        rate: null,
        formatted: "N/A",
        isEstimated: false,
        methodology: "Historical vault performance data is insufficient.",
      },
    });

    mockEstimateApy.mockResolvedValue({
      apy: 0.095,
      contractId: TEST_VAULT_CONTRACT_ID,
    });

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.apy).toBe("9.50%");
    expect(body.data.apy).toBe("9.50%");
    expect(body.data.apyRate).toBe(0.095);
    expect(body.data.apyInfo.isEstimated).toBe(true);
  });

  it("handles DefindexServiceError with kind 'configuration'", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindFirst.mockResolvedValue({
      id: "user-123",
      stellarAddress: TEST_STELLAR_ADDRESS,
      vaultContractId: null,
      savingsStatus: "active",
      savingsBalance: 0,
    });
    mockGetVaultBalance.mockRejectedValue(
      new DefindexServiceError("Vault contract not configured", "configuration"),
    );

    const res = await GET(createRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.title).toBe("Internal Server Error");
    expect(json.detail).toBe("The DeFindex vault is not configured correctly");
  });

  it("handles DefindexServiceError with kind 'upstream'", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindFirst.mockResolvedValue({
      id: "user-123",
      stellarAddress: TEST_STELLAR_ADDRESS,
      vaultContractId: TEST_VAULT_CONTRACT_ID,
      savingsStatus: "active",
      savingsBalance: 0,
    });
    mockGetVaultBalance.mockRejectedValue(
      new DefindexServiceError("Soroban RPC connection refused", "upstream"),
    );

    const res = await GET(createRequest());
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.title).toBe("Bad Gateway");
    expect(json.detail).toBe(
      "The DeFindex vault could not be reached or simulated at this time",
    );
  });

  it("handles DefindexServiceError with kind 'validation'", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindFirst.mockResolvedValue({
      id: "user-123",
      stellarAddress: "invalid-key",
      vaultContractId: TEST_VAULT_CONTRACT_ID,
      savingsStatus: "active",
      savingsBalance: 0,
    });
    mockGetVaultBalance.mockRejectedValue(
      new DefindexServiceError("Invalid Stellar public key format", "validation"),
    );

    const res = await GET(createRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.title).toBe("Bad Request");
    expect(json.detail).toBe("Invalid Stellar public key format");
  });

  it("handles generic unexpected errors with 500", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindFirst.mockRejectedValue(new Error("Database connection dropped"));

    const res = await GET(createRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.title).toBe("Internal Server Error");
    expect(json.detail).toBe("Failed to retrieve savings dashboard data");
  });

  it("verifies GET /api/savings/dashboard is mounted on apiRouter", async () => {
    const { apiRouter } = await import("@/routes");
    const routeLayer = apiRouter.stack.find(
      (layer: any) =>
        layer.route &&
        layer.route.path === "/api/savings/dashboard" &&
        layer.route.methods.get === true,
    );

    expect(routeLayer).toBeDefined();
    expect(routeLayer?.route?.path).toBe("/api/savings/dashboard");
  });
});


