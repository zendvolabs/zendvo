import {
  DefindexServiceError,
  estimateApyFromSharePrices,
  getVaultDashboardMetrics,
} from "@/lib/services/defindex_service";

const mockGetVaultInfo = jest.fn();
const mockGetVaultBalance = jest.fn();
const mockGetVaultApy = jest.fn();

jest.mock("@defindex/sdk", () => ({
  SupportedNetworks: { TESTNET: "testnet", MAINNET: "mainnet" },
  DefindexSDK: jest.fn().mockImplementation(() => ({
    getVaultInfo: mockGetVaultInfo,
    getVaultBalance: mockGetVaultBalance,
    getVaultAPY: mockGetVaultApy,
  })),
}));

const VAULT_ADDRESS =
  "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR";
const STELLAR_ADDRESS =
  "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN";

describe("defindex_service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEFINDEX_API_KEY = "test-api-key";
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.STELLAR_RPC_URL;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;

    mockGetVaultInfo.mockResolvedValue({ name: "Savings Vault", symbol: "dUSDC" });
    mockGetVaultBalance.mockResolvedValue({
      dfTokens: 100,
      underlyingBalance: [105],
    });
    mockGetVaultApy.mockResolvedValue({ apy: 7.25 });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("throws a configuration error when the API key is missing", async () => {
    delete process.env.DEFINDEX_API_KEY;

    await expect(
      getVaultDashboardMetrics({
        vaultAddress: VAULT_ADDRESS,
        stellarAddress: STELLAR_ADDRESS,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "DEFINDEX_NOT_CONFIGURED",
    });
  });

  it("returns vault metrics with a derived share price and formatted APY", async () => {
    const metrics = await getVaultDashboardMetrics({
      vaultAddress: VAULT_ADDRESS,
      stellarAddress: STELLAR_ADDRESS,
    });

    expect(metrics).toEqual({
      vaultBalance: 105,
      shareBalance: 100,
      sharePrice: 1.05,
      apy: { rate: 7.25, formatted: "7.25%" },
    });
  });

  it("estimates APY from share price snapshots when the SDK has no APY", async () => {
    mockGetVaultApy.mockRejectedValue(new Error("APY unavailable"));

    const metrics = await getVaultDashboardMetrics({
      vaultAddress: VAULT_ADDRESS,
      stellarAddress: STELLAR_ADDRESS,
      sharePriceHistory: [
        {
          sharePrice: 1,
          recordedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
        {
          sharePrice: 1.1,
          recordedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });

    expect(metrics.apy).toEqual({ rate: 10, formatted: "10.00%" });
  });

  it("throws a gateway error when the vault balance cannot be loaded", async () => {
    mockGetVaultBalance.mockRejectedValue(new Error("network down"));

    await expect(
      getVaultDashboardMetrics({
        vaultAddress: VAULT_ADDRESS,
        stellarAddress: STELLAR_ADDRESS,
      }),
    ).rejects.toBeInstanceOf(DefindexServiceError);
  });

  it("annualizes share price growth from historical snapshots", () => {
    expect(
      estimateApyFromSharePrices([
        { sharePrice: 100, recordedAt: "2026-01-01T00:00:00.000Z" },
        { sharePrice: 110, recordedAt: "2026-07-01T00:00:00.000Z" },
      ]),
    ).toBeCloseTo(21.19, 1);
  });

  it("returns null when fewer than two snapshots are available", () => {
    expect(
      estimateApyFromSharePrices([
        { sharePrice: 1, recordedAt: "2026-01-01T00:00:00.000Z" },
      ]),
    ).toBeNull();
  });
});
