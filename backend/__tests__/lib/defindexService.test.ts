import {
  Account,
  Address,
  Contract,
  Keypair,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  DefindexService,
  DefindexServiceError,
  parseUsdcAmount,
} from "../../src/lib/services/defindex_service";

jest.mock("@defindex/sdk", () => {
  const mockGetVaultInfo = jest.fn();
  const mockGetVaultAPY = jest.fn();
  const mockDepositToVault = jest.fn();
  const mockWithdrawFromVault = jest.fn();
  const MockDefindexSDK = jest.fn().mockImplementation(() => ({
    getVaultInfo: mockGetVaultInfo,
    getVaultAPY: mockGetVaultAPY,
    depositToVault: mockDepositToVault,
    withdrawFromVault: mockWithdrawFromVault,
  }));
  return {
    DefindexSDK: MockDefindexSDK,
    SupportedNetworks: { TESTNET: "testnet", MAINNET: "mainnet" },
    __mockGetVaultInfo: mockGetVaultInfo,
    __mockGetVaultAPY: mockGetVaultAPY,
    __mockDepositToVault: mockDepositToVault,
    __mockWithdrawFromVault: mockWithdrawFromVault,
    __MockDefindexSDK: MockDefindexSDK,
  };
});

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  const mockSimulateTransaction = jest.fn();
  const mockGetHealth = jest.fn();
  class MockServer {
    url: string;
    simulateTransaction = mockSimulateTransaction;
    getHealth = mockGetHealth;

    constructor(url: string) {
      this.url = url;
    }
  }
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: MockServer,
    },
    __mockSimulateTransaction: mockSimulateTransaction,
    __mockGetHealth: mockGetHealth,
  };
});

const mockSimulateTransaction = (require("@stellar/stellar-sdk") as any)
  .__mockSimulateTransaction as jest.Mock;
const mockGetHealth = (require("@stellar/stellar-sdk") as any)
  .__mockGetHealth as jest.Mock;
const mockGetVaultInfo = (require("@defindex/sdk") as any)
  .__mockGetVaultInfo as jest.Mock;
const mockGetVaultAPY = (require("@defindex/sdk") as any)
  .__mockGetVaultAPY as jest.Mock;
const mockDepositToVault = (require("@defindex/sdk") as any)
  .__mockDepositToVault as jest.Mock;
const mockWithdrawFromVault = (require("@defindex/sdk") as any)
  .__mockWithdrawFromVault as jest.Mock;
const MockDefindexSDK = (require("@defindex/sdk") as any)
  .__MockDefindexSDK as jest.Mock;

// ── Fixtures ────────────────────────────────────────────────────────────────
const VAULT_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const USER_ADDRESS = Keypair.random().publicKey();

// Vault state (single-asset USDC vault):
// - 1,000 USDC managed (10_000_000_000 units, 7 decimals)
// - 10,000 vault shares in circulation
// - user holds 5,000 shares
const BALANCE_OF = 5000n;
const TOTAL_SUPPLY = 10000n;
const TOTAL_MANAGED = 10_000_000_000n; // 1,000 USDC

// Requested withdrawal: 10 USDC (100_000_000 units)
const REQUESTED_AMOUNT = "100000000";
const EXPECTED_SHARES = 100n; // ceil(amount * supply / managed)
const EXPECTED_ASSETS = 100_000_000n; // floor(shares * managed / supply)
const EXPECTED_SHARE_PRICE = (TOTAL_MANAGED * 10n ** 7n) / TOTAL_SUPPLY; // scaled 1e7

function successResponse(
  retval: xdr.ScVal,
  auth: xdr.SorobanAuthorizationEntry[] = [],
) {
  return {
    id: "1",
    latestLedger: 123,
    events: [],
    _parsed: true,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: "0",
    result: { auth, retval },
  };
}

function errorResponse(error: string) {
  return {
    id: "1",
    latestLedger: 123,
    events: [],
    _parsed: true,
    error,
  };
}

function managedFundsResponse(totalManaged: bigint = TOTAL_MANAGED) {
  const entry = (name: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val });
  const allocation = xdr.ScVal.scvMap([
    entry("asset", Address.fromString(USER_ADDRESS).toScVal()),
    entry("total_amount", nativeToScVal(totalManaged, { type: "i128" })),
    entry("idle_amount", nativeToScVal(0n, { type: "i128" })),
    entry("invested_amount", nativeToScVal(totalManaged, { type: "i128" })),
    entry("strategy_allocations", xdr.ScVal.scvVec([])),
  ]);
  return xdr.ScVal.scvVec([allocation]);
}

function invokedMethod(tx: any): string {
  return tx.operations[0].func.invokeContract().functionName().toString();
}

function hostFunctionOf(envelope: xdr.TransactionEnvelope): xdr.HostFunction {
  const op = envelope.v1().tx().operations()[0];
  return (op.body().value() as any).hostFunction() as xdr.HostFunction;
}

function sdkDepositXdr(): string {
  return new TransactionBuilder(new Account(USER_ADDRESS, "0"), {
    fee: "100",
    networkPassphrase: "Test SDF Network ; September 2015",
  })
    .addOperation(new Contract(VAULT_CONTRACT_ID).call("deposit"))
    .setTimeout(30)
    .build()
    .toXDR();
}

describe("DefindexService.calculateWithdrawalParams", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEFINDEX_VAULT_CONTRACT_ID = VAULT_CONTRACT_ID;
    process.env.SOROBAN_RPC_URL = "https://fake-rpc.example.com";
    delete process.env.STELLAR_NETWORK_PASSPHRASE;

    mockGetHealth.mockResolvedValue({ status: "healthy" });
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "balance_of":
          return successResponse(nativeToScVal(BALANCE_OF, { type: "i128" }));
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse());
        case "withdraw":
          return successResponse(
            nativeToScVal([EXPECTED_ASSETS], { type: "i128" }),
          );
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });
  });

  afterEach(() => {
    delete process.env.DEFINDEX_VAULT_CONTRACT_ID;
    delete process.env.SOROBAN_RPC_URL;
  });

  it("computes withdrawal parameters and returns an unsigned withdrawal XDR", async () => {
    const result = await DefindexService.calculateWithdrawalParams(
      USER_ADDRESS,
      REQUESTED_AMOUNT,
    );

    expect(result.userAddress).toBe(USER_ADDRESS);
    expect(result.amount).toBe(REQUESTED_AMOUNT);
    expect(result.sharesToBurn).toBe(EXPECTED_SHARES.toString());
    expect(result.expectedAssets).toBe(EXPECTED_ASSETS.toString());
    expect(result.minAmountsOut).toEqual([EXPECTED_ASSETS.toString()]);
    expect(result.sharePrice).toBe(EXPECTED_SHARE_PRICE.toString());
    expect(result.userBalance).toBe(BALANCE_OF.toString());
    expect(result.totalManagedFunds).toBe(TOTAL_MANAGED.toString());
    expect(result.totalSupply).toBe(TOTAL_SUPPLY.toString());
    expect(result.contractId).toBe(VAULT_CONTRACT_ID);
    expect(result.rpcUrl).toBe("https://fake-rpc.example.com");
    expect(result.unsignedXdr).toBeTruthy();
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("builds a withdraw invocation with the correct Soroban arguments", async () => {
    const result = await DefindexService.calculateWithdrawalParams(
      USER_ADDRESS,
      REQUESTED_AMOUNT,
    );

    const envelope = xdr.TransactionEnvelope.fromXDR(
      result.unsignedXdr,
      "base64",
    );
    const hostFunction = hostFunctionOf(envelope);
    const contractArgs = hostFunction.invokeContract();

    expect(contractArgs.functionName().toString()).toBe("withdraw");
    expect(
      StrKey.encodeContract(
        contractArgs.contractAddress().contractId() as unknown as Buffer,
      ),
    ).toBe(VAULT_CONTRACT_ID);

    const args = contractArgs.args();
    expect(args).toHaveLength(3);

    // 1. withdraw_shares: i128
    expect(args[0].switch().name).toBe("scvI128");
    expect(scValToNative(args[0])).toBe(EXPECTED_SHARES);

    // 2. min_amounts_out: Vec<i128> with one entry per vault asset
    expect(args[1].switch().name).toBe("scvVec");
    expect(scValToNative(args[1])).toEqual([EXPECTED_ASSETS]);

    // 3. from: Address
    expect(scValToNative(args[2])).toBe(USER_ADDRESS);
  });

  it("queries balance_of, total_supply and managed funds over Soroban RPC and simulates the withdrawal", async () => {
    await DefindexService.calculateWithdrawalParams(
      USER_ADDRESS,
      REQUESTED_AMOUNT,
    );

    const simulatedMethods = mockSimulateTransaction.mock.calls.map(([tx]) =>
      invokedMethod(tx),
    );
    expect(simulatedMethods).toEqual([
      "balance_of",
      "total_supply",
      "fetch_total_managed_funds",
      "withdraw",
    ]);
  });

  it("rounds shares up so the user receives at least the requested amount", async () => {
    // Managed funds that make the share price uneven: 999 USDC over 10,000
    // shares. Withdrawing 100_000_000 units needs ceil(1e8 * 1e4 / 9.99e9)
    // = 101 shares, which pays out floor(101 * 9.99e9 / 1e4) = 100_899_000
    // units (>= requested).
    const unevenManaged = 9_990_000_000n;
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "balance_of":
          return successResponse(nativeToScVal(1000n, { type: "i128" }));
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse(unevenManaged));
        case "withdraw":
          return successResponse(
            nativeToScVal([100_899_000n], { type: "i128" }),
          );
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    const result = await DefindexService.calculateWithdrawalParams(
      USER_ADDRESS,
      REQUESTED_AMOUNT,
    );

    expect(result.sharesToBurn).toBe("101");
    expect(result.expectedAssets).toBe("100899000");
    expect(BigInt(result.expectedAssets)).toBeGreaterThanOrEqual(
      BigInt(REQUESTED_AMOUNT),
    );
  });

  it("throws when the requested amount exceeds the user's vault balance", async () => {
    // User holds 5,000 shares of 10,000 total; max withdrawable is
    // floor(5000 * 10_000_000_000 / 10000) = 5_000_000_000 units (500 USDC).
    await expect(
      DefindexService.calculateWithdrawalParams(USER_ADDRESS, "6000000000"),
    ).rejects.toThrow(DefindexServiceError);
    await expect(
      DefindexService.calculateWithdrawalParams(USER_ADDRESS, "6000000000"),
    ).rejects.toThrow(/Insufficient vault balance/);
  });

  it("throws for invalid amounts", async () => {
    for (const amount of ["0", "-5", "abc", "1.5", ""]) {
      await expect(
        DefindexService.calculateWithdrawalParams(USER_ADDRESS, amount),
      ).rejects.toThrow(/Invalid withdrawal amount/);
    }
  });

  it("throws for an invalid user address", async () => {
    await expect(
      DefindexService.calculateWithdrawalParams("not-a-stellar-address", "100"),
    ).rejects.toThrow(/Invalid user address/);
  });

  it("throws when the DeFindex vault contract id is not configured", async () => {
    delete process.env.DEFINDEX_VAULT_CONTRACT_ID;
    await expect(
      DefindexService.calculateWithdrawalParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toThrow(/DEFINDEX_VAULT_CONTRACT_ID/);
  });

  it("throws when a contract query fails on the RPC", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      if (invokedMethod(tx) === "balance_of") {
        return errorResponse("HostError: contract invocation failed");
      }
      throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
    });

    await expect(
      DefindexService.calculateWithdrawalParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toThrow(/Failed to query balance_of/);
  });

  it("throws when the withdrawal simulation reports an error", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "balance_of":
          return successResponse(nativeToScVal(BALANCE_OF, { type: "i128" }));
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse());
        case "withdraw":
          return errorResponse("HostError: vault paused");
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    await expect(
      DefindexService.calculateWithdrawalParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toThrow(/Withdrawal simulation failed/);
  });

  it("throws an upstream DefindexServiceError when the RPC is unreachable during simulation", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      if (invokedMethod(tx) === "withdraw") {
        throw new Error("network down");
      }
      switch (invokedMethod(tx)) {
        case "balance_of":
          return successResponse(nativeToScVal(BALANCE_OF, { type: "i128" }));
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse());
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    await expect(
      DefindexService.calculateWithdrawalParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toThrow(DefindexServiceError);

    await expect(
      DefindexService.calculateWithdrawalParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining("Withdrawal simulation failed for vault"),
    });
  });

  it("wraps unexpected errors in DefindexServiceError", async () => {
    mockSimulateTransaction.mockRejectedValue(new Error("rpc exploded"));

    await expect(
      DefindexService.calculateWithdrawalParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toThrow(DefindexServiceError);
  });
});

describe("parseUsdcAmount", () => {
  it.each([
    ["50", 500000000n],
    ["50.00", 500000000n],
    ["0.0000001", 1n],
    ["0001.2300000", 12300000n],
    [" 50.1234567 ", 501234567n],
  ])("converts %s to exact 7-decimal units", (amount, expected) => {
    expect(parseUsdcAmount(amount)).toBe(expected);
  });

  it.each([
    "",
    "0",
    "0.0000000",
    "-1",
    "+1",
    ".5",
    "1.",
    "1.00000001",
    "1e2",
    "1,000",
    "1 0",
  ])("rejects invalid human USDC amount %s", (amount) => {
    expect(() => parseUsdcAmount(amount)).toThrow(/Invalid USDC amount/);
  });

  it("rejects an amount outside Soroban's i128 range", () => {
    expect(() =>
      parseUsdcAmount("340282366920938463463374607431768211456"),
    ).toThrow(/i128 range/);
  });
});

describe("DefindexService deposit XDR builders", () => {
  const DEPOSIT_AMOUNT = "100000000"; // 10 USDC

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEFINDEX_VAULT_CONTRACT_ID = VAULT_CONTRACT_ID;
    process.env.SOROBAN_RPC_URL = "https://fake-rpc.example.com";
    delete process.env.STELLAR_NETWORK_PASSPHRASE;

    mockGetHealth.mockResolvedValue({ status: "healthy" });
    mockDepositToVault.mockResolvedValue({
      xdr: sdkDepositXdr(),
      simulationResponse: {},
      functionName: "deposit",
      params: [],
    });
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse());
        case "balance_of":
          return successResponse(nativeToScVal(BALANCE_OF, { type: "i128" }));
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });
  });

  afterEach(() => {
    delete process.env.DEFINDEX_VAULT_CONTRACT_ID;
    delete process.env.SOROBAN_RPC_URL;
  });

  it("builds a simulated SDK XDR from a human-readable USDC amount", async () => {
    const result = await DefindexService.buildDeFindexDepositXdr(
      USER_ADDRESS,
      "50.00",
    );

    expect(result.amount).toBe("500000000");
    expect(result.estimatedShares).toBe("500");
    expect(result.unsignedXdr).toBeTruthy();
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);

    expect(result.unsignedXdr).toBe(sdkDepositXdr());
    expect(mockDepositToVault).toHaveBeenCalledWith(
      VAULT_CONTRACT_ID,
      { amounts: [500000000], caller: USER_ADDRESS, invest: true },
      "testnet",
    );
  });

  it("computes deposit parameters and returns an unsigned deposit XDR", async () => {
    const result = await DefindexService.calculateDepositParams(
      USER_ADDRESS,
      DEPOSIT_AMOUNT,
    );

    expect(result.userAddress).toBe(USER_ADDRESS);
    expect(result.amount).toBe(DEPOSIT_AMOUNT);
    // 100_000_000 units / ($1000 USDC over 10k shares => 0.0001 USDC/share)
    // estimatedShares = floor(amount * supply / managed)
    expect(result.estimatedShares).toBe("100");
    expect(result.sharePrice).toBe(EXPECTED_SHARE_PRICE.toString());
    expect(result.userBalance).toBe(BALANCE_OF.toString());
    expect(result.totalManagedFunds).toBe(TOTAL_MANAGED.toString());
    expect(result.totalSupply).toBe(TOTAL_SUPPLY.toString());
    expect(result.contractId).toBe(VAULT_CONTRACT_ID);
    expect(result.rpcUrl).toBe("https://fake-rpc.example.com");
    expect(result.unsignedXdr).toBeTruthy();
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("queries only vault metadata over Soroban RPC and delegates the deposit simulation to the SDK", async () => {
    await DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT);

    const simulatedMethods = mockSimulateTransaction.mock.calls.map(([tx]) =>
      invokedMethod(tx),
    );
    expect(simulatedMethods).toEqual([
      "total_supply",
      "fetch_total_managed_funds",
      "balance_of",
    ]);
    expect(mockDepositToVault).toHaveBeenCalledWith(
      VAULT_CONTRACT_ID,
      { amounts: [100000000], caller: USER_ADDRESS, invest: true },
      "testnet",
    );
  });

  it("assumes a 1:1 share price when the vault is empty", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "total_supply":
          return successResponse(nativeToScVal(0n, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse(0n));
        case "balance_of":
          return successResponse(nativeToScVal(0n, { type: "i128" }));
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    const result = await DefindexService.calculateDepositParams(
      USER_ADDRESS,
      DEPOSIT_AMOUNT,
    );

    expect(result.sharePrice).toBe((10n ** 7n).toString());
    expect(result.estimatedShares).toBe(DEPOSIT_AMOUNT);
  });

  it("throws for invalid amounts", async () => {
    for (const amount of ["0", "-5", "abc", "1.5", ""]) {
      await expect(
        DefindexService.calculateDepositParams(USER_ADDRESS, amount),
      ).rejects.toThrow(/Invalid deposit amount/);
    }
  });

  it("throws for an invalid user address", async () => {
    await expect(
      DefindexService.calculateDepositParams("not-a-stellar-address", "100"),
    ).rejects.toThrow(/Invalid user address/);
  });

  it("throws when the DeFindex vault contract id is not configured", async () => {
    delete process.env.DEFINDEX_VAULT_CONTRACT_ID;
    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toThrow(/DEFINDEX_VAULT_CONTRACT_ID/);
  });

  it("throws when a contract query fails on the RPC", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      if (invokedMethod(tx) === "total_supply") {
        return errorResponse("HostError: contract invocation failed");
      }
      throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
    });

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toThrow(/Failed to query total_supply/);
  });

  it("fails upstream when the SDK deposit call fails", async () => {
    mockDepositToVault.mockRejectedValueOnce(new Error("vault paused"));

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining("Failed to build simulated DeFindex deposit"),
    });
  });

  it("fails upstream when the SDK returns an empty XDR", async () => {
    mockDepositToVault.mockResolvedValueOnce({ xdr: "", simulationResponse: {} });

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining("returned no transaction XDR"),
    });
  });

  it("fails upstream when the SDK omits its simulation response", async () => {
    mockDepositToVault.mockResolvedValueOnce({ xdr: sdkDepositXdr() });

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining("returned no simulation response"),
    });
  });

  it("rejects amounts the SDK cannot represent safely", async () => {
    await expect(
      DefindexService.buildDeFindexDepositXdr(USER_ADDRESS, "900719925.4740992"),
    ).rejects.toMatchObject({ kind: "validation" });
    expect(mockDepositToVault).not.toHaveBeenCalled();
  });

  it("wraps unexpected errors in DefindexServiceError", async () => {
    mockSimulateTransaction.mockRejectedValue(new Error("rpc exploded"));

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toThrow(DefindexServiceError);
  });

  it("throws when the vault has shares but no managed funds", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse(0n));
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toThrow(
      /has shares in circulation but manages no USDC funds/,
    );
  });

  it("throws when the vault manages funds but has no shares", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "total_supply":
          return successResponse(nativeToScVal(0n, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse());
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toThrow(
      /manages .* units but has no shares in circulation/,
    );
  });

  it("classifies validation errors as kind 'validation'", async () => {
    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, "abc"),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("classifies configuration errors as kind 'configuration'", async () => {
    delete process.env.DEFINDEX_VAULT_CONTRACT_ID;
    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toMatchObject({ kind: "configuration" });
  });

  it("classifies RPC failures as kind 'upstream'", async () => {
    mockSimulateTransaction.mockRejectedValue(new Error("rpc exploded"));

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, DEPOSIT_AMOUNT),
    ).rejects.toMatchObject({ kind: "upstream" });
  });
});

describe("DefindexService.getVaultBalance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    DefindexService.clearCache();
    process.env.DEFINDEX_VAULT_CONTRACT_ID = VAULT_CONTRACT_ID;
    process.env.SOROBAN_RPC_URL = "https://fake-rpc.example.com";
    delete process.env.STELLAR_NETWORK_PASSPHRASE;

    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "balance_of":
          return successResponse(nativeToScVal(BALANCE_OF, { type: "i128" }));
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse());
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });
  });

  afterEach(() => {
    DefindexService.clearCache();
    delete process.env.DEFINDEX_VAULT_CONTRACT_ID;
    delete process.env.SOROBAN_RPC_URL;
  });

  it("queries balance_of, total_supply, and managed_funds and calculates vault position and underlying USDC", async () => {
    const result = await DefindexService.getVaultBalance(USER_ADDRESS);

    expect(result.userAddress).toBe(USER_ADDRESS);
    expect(result.contractId).toBe(VAULT_CONTRACT_ID);
    expect(result.rawUserBalance).toBe(BALANCE_OF.toString());
    expect(result.userBalance).toBe("0.0005000"); // 5,000 / 1e7
    expect(result.rawSharePrice).toBe(EXPECTED_SHARE_PRICE.toString());
    expect(result.sharePrice).toBe("1000000.0000000");
    // user owns 5,000 of 10,000 shares of 10_000_000_000 managed => 5_000_000_000 (500 USDC)
    expect(result.rawUnderlyingUsdc).toBe("5000000000");
    expect(result.underlyingUsdc).toBe("500.0000000");
    expect(result.rawTotalSupply).toBe(TOTAL_SUPPLY.toString());
    expect(result.rawTotalManagedFunds).toBe(TOTAL_MANAGED.toString());
    expect(result.rpcUrl).toBe("https://fake-rpc.example.com");
    expect(result.apy.rate).toBeNull();
    expect(result.apy.formatted).toBe("N/A");
    expect(result.apy.isEstimated).toBe(false);
    expect(result.fetchedAt).toBeTruthy();
  });

  it("handles zero user share balance correctly", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "balance_of":
          return successResponse(nativeToScVal(0n, { type: "i128" }));
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse());
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    const result = await DefindexService.getVaultBalance(USER_ADDRESS);

    expect(result.rawUserBalance).toBe("0");
    expect(result.userBalance).toBe("0.0000000");
    expect(result.rawUnderlyingUsdc).toBe("0");
    expect(result.underlyingUsdc).toBe("0.0000000");
  });

  it("handles empty vault state (0 total supply, 0 managed funds) with 1:1 exchange rate fallback", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "balance_of":
          return successResponse(nativeToScVal(0n, { type: "i128" }));
        case "total_supply":
          return successResponse(nativeToScVal(0n, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse(0n));
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    const result = await DefindexService.getVaultBalance(USER_ADDRESS);

    expect(result.rawSharePrice).toBe("10000000"); // 10^7 = 1.0000000
    expect(result.sharePrice).toBe("1.0000000");
    expect(result.rawUnderlyingUsdc).toBe("0");
  });

  it("preserves large integer precision without JS float truncation", async () => {
    const hugeBalance = 123_456_789_012_345_678n;
    const hugeSupply = 200_000_000_000_000_000n;
    const hugeManaged = 400_000_000_000_000_000n; // share price = 2 * 1e7

    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "balance_of":
          return successResponse(nativeToScVal(hugeBalance, { type: "i128" }));
        case "total_supply":
          return successResponse(nativeToScVal(hugeSupply, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse(hugeManaged));
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    const result = await DefindexService.getVaultBalance(USER_ADDRESS);

    expect(result.rawUserBalance).toBe(hugeBalance.toString());
    const expectedUnderlying = (hugeBalance * hugeManaged) / hugeSupply;
    expect(result.rawUnderlyingUsdc).toBe(expectedUnderlying.toString());
  });

  it("caches successful RPC responses and deduplicates repeated calls within TTL", async () => {
    const first = await DefindexService.getVaultBalance(USER_ADDRESS);
    const second = await DefindexService.getVaultBalance(USER_ADDRESS);

    expect(second).toEqual(first);
    // balance_of, total_supply, fetch_total_managed_funds called once
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(3);
  });

  it("bypasses cache when skipCache is true", async () => {
    await DefindexService.getVaultBalance(USER_ADDRESS);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(3);

    await DefindexService.getVaultBalance(USER_ADDRESS, undefined, {
      skipCache: true,
    });
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(6);
  });

  it("expires cached entries after TTL", async () => {
    await DefindexService.getVaultBalance(USER_ADDRESS, undefined, {
      ttlMs: 50,
    });
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(3);

    await new Promise((resolve) => setTimeout(resolve, 60));

    await DefindexService.getVaultBalance(USER_ADDRESS);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(6);
  });

  it("calculates APY when a valid historical share price snapshot is provided", async () => {
    // Current share price: EXPECTED_SHARE_PRICE (10_000_000_000_000n)
    // Snapshot from 30 days ago with share price 5% lower (9_500_000_000_000n)
    const pastTimestamp = Math.floor(Date.now() / 1000) - 30 * 86400;
    const pastSharePrice = (EXPECTED_SHARE_PRICE * 95n) / 100n;

    const result = await DefindexService.getVaultBalance(USER_ADDRESS, undefined, {
      historicalSnapshot: {
        timestamp: pastTimestamp,
        sharePrice: pastSharePrice.toString(),
      },
    });

    expect(result.apy.isEstimated).toBe(true);
    expect(result.apy.rate).toBeGreaterThan(0);
    expect(result.apy.formatted).toMatch(/^[0-9]+\.[0-9]{2}%$/);
    expect(result.apy.methodology).toContain("Annualized return derived from historical share price increase");
  });

  it("returns APY rate null when historical snapshot is missing or elapsed time is under 1 hour", async () => {
    const recentTimestamp = Math.floor(Date.now() / 1000) - 60; // 1 min ago
    const pastSharePrice = (EXPECTED_SHARE_PRICE * 95n) / 100n;
    const result = await DefindexService.getVaultBalance(USER_ADDRESS, undefined, {
      historicalSnapshot: {
        timestamp: recentTimestamp,
        sharePrice: pastSharePrice.toString(),
      },
    });

    expect(result.apy.rate).toBeNull();
    expect(result.apy.formatted).toBe("N/A");
    expect(result.apy.isEstimated).toBe(false);
  });

  it("throws validation error for an invalid user address", async () => {
    await expect(
      DefindexService.getVaultBalance("not-a-valid-stellar-key"),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("throws configuration error when DEFINDEX_VAULT_CONTRACT_ID is not set", async () => {
    delete process.env.DEFINDEX_VAULT_CONTRACT_ID;

    await expect(
      DefindexService.getVaultBalance(USER_ADDRESS),
    ).rejects.toMatchObject({ kind: "configuration" });
  });

  it("throws upstream error on Soroban RPC failure and does not cache the error", async () => {
    mockSimulateTransaction.mockRejectedValue(new Error("RPC unavailable"));

    await expect(
      DefindexService.getVaultBalance(USER_ADDRESS),
    ).rejects.toMatchObject({ kind: "upstream" });

    // Cache should remain empty
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "balance_of":
          return successResponse(nativeToScVal(BALANCE_OF, { type: "i128" }));
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse());
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    const result = await DefindexService.getVaultBalance(USER_ADDRESS);
    expect(result.rawUserBalance).toBe(BALANCE_OF.toString());
  });

  it("supports getVaultPosition alias", async () => {
    const result = await DefindexService.getVaultPosition(USER_ADDRESS);
    expect(result.userAddress).toBe(USER_ADDRESS);
    expect(result.rawUserBalance).toBe(BALANCE_OF.toString());
  });
});

describe("DefindexService deposit builder - gap coverage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEFINDEX_VAULT_CONTRACT_ID = VAULT_CONTRACT_ID;
    process.env.SOROBAN_RPC_URL = "https://fake-rpc.example.com";
    delete process.env.STELLAR_NETWORK_PASSPHRASE;

    mockGetHealth.mockResolvedValue({ status: "healthy" });
    mockDepositToVault.mockResolvedValue({
      xdr: sdkDepositXdr(),
      simulationResponse: {},
      functionName: "deposit",
      params: [],
    });
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse());
        case "balance_of":
          return successResponse(nativeToScVal(BALANCE_OF, { type: "i128" }));
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });
  });

  afterEach(() => {
    delete process.env.DEFINDEX_VAULT_CONTRACT_ID;
    delete process.env.SOROBAN_RPC_URL;
  });

  it("rejects malformed human-readable amounts before calling the SDK", async () => {
    for (const amount of ["abc", "1e5", "50.00.00", "-5.00", ""]) {
      await expect(
        DefindexService.buildDeFindexDepositXdr(USER_ADDRESS, amount),
      ).rejects.toMatchObject({ kind: "validation" });
    }
    expect(mockDepositToVault).not.toHaveBeenCalled();
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it("wraps an invalid SDK XDR as an upstream error", async () => {
    mockDepositToVault.mockResolvedValueOnce({
      xdr: "not-valid-base64-xdr",
      simulationResponse: {},
    });

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining("invalid transaction XDR"),
    });
  });

  it("fails upstream when the vault reports no managed assets", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(
            xdr.ScVal.scvVec([]) as unknown as xdr.ScVal,
          );
        case "balance_of":
          return successResponse(nativeToScVal(BALANCE_OF, { type: "i128" }));
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining("no managed assets"),
    });
    expect(mockDepositToVault).not.toHaveBeenCalled();
  });

  it("fails upstream when the vault has shares but no managed funds", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "total_supply":
          return successResponse(nativeToScVal(TOTAL_SUPPLY, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse(0n));
        case "balance_of":
          return successResponse(nativeToScVal(BALANCE_OF, { type: "i128" }));
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining(
        "has shares in circulation but manages no USDC funds",
      ),
    });
    expect(mockDepositToVault).not.toHaveBeenCalled();
  });

  it("fails upstream when the vault manages funds but has no shares in circulation", async () => {
    mockSimulateTransaction.mockImplementation(async (tx: any) => {
      switch (invokedMethod(tx)) {
        case "total_supply":
          return successResponse(nativeToScVal(0n, { type: "i128" }));
        case "fetch_total_managed_funds":
          return successResponse(managedFundsResponse(TOTAL_MANAGED));
        case "balance_of":
          return successResponse(nativeToScVal(0n, { type: "i128" }));
        default:
          throw new Error(`Unexpected contract method ${invokedMethod(tx)}`);
      }
    });

    await expect(
      DefindexService.calculateDepositParams(USER_ADDRESS, REQUESTED_AMOUNT),
    ).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining("has no shares in circulation"),
    });
    expect(mockDepositToVault).not.toHaveBeenCalled();
  });
});
