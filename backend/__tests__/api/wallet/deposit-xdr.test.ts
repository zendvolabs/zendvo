/**
 * Service-level tests for DefindexService.buildDeFindexDepositXdr.
 *
 * Soroban RPC (rpc.Server) and the DeFindex SDK are mocked; everything else
 * (amount parsing, BigInt math, XDR parsing, tx hashing) runs for real.
 *
 * Suggested location: backend/__tests__/api/wallet/deposit-xdr.test.ts
 */

// ── Mocks (factories only touch outer variables lazily, at call time) ───────
const mockDepositToVault = jest.fn();
const mockSimulate = jest.fn();
const mockSdkCtor = jest.fn();

jest.mock("@defindex/sdk", () => ({
  // Plain function (not jest.fn) so a `resetMocks` config can't strip it.
  DefindexSDK: function DefindexSDK(cfg: unknown) {
    mockSdkCtor(cfg);
    return {
      depositToVault: (...args: unknown[]) => mockDepositToVault(...args),
      getVaultInfo: () => undefined,
      getVaultAPY: () => undefined,
      withdrawFromVault: () => undefined,
    };
  },
  SupportedNetworks: { TESTNET: "testnet", MAINNET: "mainnet" },
}));

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    // retvals in these tests are fake objects carrying their native value
    scValToNative: (v: { __native: unknown }) => v.__native,
    rpc: {
      ...actual.rpc,
      Server: function Server() {
        return {
          simulateTransaction: (...args: unknown[]) => mockSimulate(...args),
          getHealth: () => Promise.resolve({ status: "healthy" }),
        };
      },
    },
  };
});

// Keep the service from opening a real DB connection on import.
jest.mock("@/lib/db", () => ({ db: {} }));

import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  buildDeFindexDepositXdr,
  DefindexService,
  DefindexServiceError,
} from "@/lib/services/defindex_service";

// ── Fixtures ────────────────────────────────────────────────────────────────
const USER = Keypair.random().publicKey();
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 7));
const USDC = (n: number) => BigInt(Math.round(n * 1e7));

/** A real, parseable unsigned tx XDR (stands in for the SDK's output). */
function makeTxXdr(passphrase: string = Networks.TESTNET) {
  const tx = new TransactionBuilder(new Account(USER, "0"), {
    fee: "100",
    networkPassphrase: passphrase,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
    .setTimeout(30)
    .build();
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
}

const ret = (native: unknown) => ({ result: { retval: { __native: native } } });

const fund = (total: bigint) => ({
  asset: "CASSET",
  total_amount: total,
  idle_amount: total,
  invested_amount: 0n,
  strategy_allocations: [],
});

/** Queue vault state in the order calculateDepositParams queries it. */
function mockVaultState(opts: {
  supply: bigint;
  funds: ReturnType<typeof fund>[];
  balance?: bigint;
}) {
  mockSimulate
    .mockResolvedValueOnce(ret(opts.supply)) // total_supply
    .mockResolvedValueOnce(ret(opts.funds)) // fetch_total_managed_funds
    .mockResolvedValueOnce(ret(opts.balance ?? 0n)); // balance_of
}

function mockSdkOk(xdr: string) {
  mockDepositToVault.mockResolvedValueOnce({
    xdr,
    functionName: "deposit",
    simulationResponse: { latestLedger: 1 },
  });
}

// ── Suite ───────────────────────────────────────────────────────────────────
describe("DefindexService.buildDeFindexDepositXdr", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSimulate.mockReset();
    mockDepositToVault.mockReset();
    process.env.DEFINDEX_VAULT_CONTRACT_ID = VAULT;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    delete process.env.SOROBAN_RPC_URL;
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  // ── Happy path & parameter calculation ────────────────────────────────────
  describe("parameter calculation", () => {
    it("converts a human-readable amount to 7-decimal units and returns the SDK XDR", async () => {
      const { xdr, hash } = makeTxXdr();
      mockVaultState({
        supply: USDC(1000),
        funds: [fund(USDC(2000))],
        balance: USDC(5),
      });
      mockSdkOk(xdr);

      const res = await DefindexService.buildDeFindexDepositXdr(USER, "50.00");

      expect(res.amount).toBe("500000000");
      expect(res.unsignedXdr).toBe(xdr);
      expect(res.txHash).toBe(hash);
      expect(res.txHash).toMatch(/^[0-9a-f]{64}$/);
      expect(res.userAddress).toBe(USER);
      expect(res.contractId).toBe(VAULT);
      expect(res.networkPassphrase).toBe(Networks.TESTNET);
      expect(res.rpcUrl).toBe("https://soroban-testnet.stellar.org");
      expect(res.userBalance).toBe(USDC(5).toString());
      expect(res.totalSupply).toBe(USDC(1000).toString());
      expect(res.totalManagedFunds).toBe(USDC(2000).toString());
    });

    it("derives share price and estimated shares from vault state", async () => {
      // price = 2000 / 1000 = 2.0 → 20_000_000 ; 50 USDC buys 25 shares
      mockVaultState({ supply: USDC(1000), funds: [fund(USDC(2000))] });
      mockSdkOk(makeTxXdr().xdr);

      const res = await DefindexService.buildDeFindexDepositXdr(USER, "50");

      expect(res.sharePrice).toBe("20000000");
      expect(res.estimatedShares).toBe(USDC(25).toString());
    });

    it("floors estimated shares when the division is inexact", async () => {
      // supply 3, funds 10 (raw units), deposit 1 raw unit → 3*1/10 = 0
      mockVaultState({ supply: 3n, funds: [fund(10n)] });
      mockSdkOk(makeTxXdr().xdr);

      const res = await DefindexService.buildDeFindexDepositXdr(
        USER,
        "0.0000001",
      );

      expect(res.amount).toBe("1");
      expect(res.estimatedShares).toBe("0");
    });

    it("sums total_amount across all managed assets", async () => {
      mockVaultState({
        supply: USDC(1000),
        funds: [fund(USDC(600)), fund(USDC(400))],
      });
      mockSdkOk(makeTxXdr().xdr);

      const res = await DefindexService.buildDeFindexDepositXdr(USER, "10");

      expect(res.totalManagedFunds).toBe(USDC(1000).toString());
      expect(res.sharePrice).toBe("10000000");
    });

    it("uses a 1:1 share price for a brand-new vault (zero supply, zero funds)", async () => {
      mockVaultState({ supply: 0n, funds: [fund(0n)] });
      mockSdkOk(makeTxXdr().xdr);

      const res = await DefindexService.buildDeFindexDepositXdr(USER, "12.5");

      expect(res.sharePrice).toBe("10000000");
      expect(res.estimatedShares).toBe("125000000");
    });

    it.each([
      ["1", "10000000"],
      ["1.5", "15000000"],
      ["0.0000001", "1"],
      ["  7.25  ", "72500000"],
      ["0.1234567", "1234567"],
    ])("parses %p to %p smallest units", async (input, expected) => {
      mockVaultState({ supply: 0n, funds: [fund(0n)] });
      mockSdkOk(makeTxXdr().xdr);

      const res = await DefindexService.buildDeFindexDepositXdr(USER, input);

      expect(res.amount).toBe(expected);
    });
  });

  // ── SDK / RPC call contract ───────────────────────────────────────────────
  describe("DeFindex SDK and RPC interaction", () => {
    it("calls depositToVault with the numeric amount, caller, invest=true and network", async () => {
      mockVaultState({ supply: 0n, funds: [fund(0n)] });
      mockSdkOk(makeTxXdr().xdr);

      await DefindexService.buildDeFindexDepositXdr(USER, "50.00");

      expect(mockDepositToVault).toHaveBeenCalledTimes(1);
      expect(mockDepositToVault).toHaveBeenCalledWith(
        VAULT,
        { amounts: [500000000], caller: USER, invest: true },
        "testnet",
      );
    });

    it("queries total_supply, fetch_total_managed_funds and balance_of via RPC", async () => {
      mockVaultState({ supply: 0n, funds: [fund(0n)] });
      mockSdkOk(makeTxXdr().xdr);

      await DefindexService.buildDeFindexDepositXdr(USER, "1");

      expect(mockSimulate).toHaveBeenCalledTimes(3);
    });

    it("targets mainnet when the passphrase is the public network", async () => {
      process.env.STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
      mockVaultState({ supply: 0n, funds: [fund(0n)] });
      mockSdkOk(makeTxXdr(Networks.PUBLIC).xdr);

      const res = await DefindexService.buildDeFindexDepositXdr(USER, "1");

      expect(mockDepositToVault.mock.calls[0][2]).toBe("mainnet");
      expect(res.networkPassphrase).toBe(Networks.PUBLIC);
    });

    it("passes API key / base URL from env to the SDK constructor", async () => {
      process.env.DEFINDEX_API_KEY = "test-key";
      process.env.DEFINDEX_API_URL = "https://api.example.com";
      mockVaultState({ supply: 0n, funds: [fund(0n)] });
      mockSdkOk(makeTxXdr().xdr);

      await DefindexService.buildDeFindexDepositXdr(USER, "1");

      expect(mockSdkCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "test-key",
          baseUrl: "https://api.example.com",
          defaultNetwork: "testnet",
        }),
      );
      delete process.env.DEFINDEX_API_KEY;
      delete process.env.DEFINDEX_API_URL;
    });

    it("is also exposed as a standalone function with identical behavior", async () => {
      mockVaultState({ supply: 0n, funds: [fund(0n)] });
      mockSdkOk(makeTxXdr().xdr);

      const res = await buildDeFindexDepositXdr(USER, "2");

      expect(res.amount).toBe("20000000");
    });
  });

  // ── Input validation (nothing should reach RPC or the SDK) ────────────────
  describe("input validation", () => {
    it.each([
      ["empty string", ""],
      ["letters", "abc"],
      ["negative", "-5"],
      ["zero", "0"],
      ["zero with decimals", "0.0000000"],
      ["too many decimals", "1.12345678"],
      ["scientific notation", "1e5"],
      ["comma separator", "1,5"],
      ["trailing dot", "5."],
      ["leading dot", ".5"],
    ])("rejects %s as a validation error", async (_label, amount) => {
      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, amount),
      ).rejects.toMatchObject({
        name: "DefindexServiceError",
        kind: "validation",
      });

      expect(mockSimulate).not.toHaveBeenCalled();
      expect(mockDepositToVault).not.toHaveBeenCalled();
    });

    it("rejects amounts above the JS safe-integer range required by the SDK", async () => {
      // 1,000,000,000 USDC = 1e16 smallest units > Number.MAX_SAFE_INTEGER
      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "1000000000"),
      ).rejects.toMatchObject({
        kind: "validation",
        message: expect.stringContaining("safe integer"),
      });
      expect(mockDepositToVault).not.toHaveBeenCalled();
    });

    it("rejects amounts above the i128 range", async () => {
      const huge = "9".repeat(40);
      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, huge),
      ).rejects.toMatchObject({
        kind: "validation",
        message: expect.stringContaining("i128"),
      });
    });

    it("rejects an invalid user address", async () => {
      await expect(
        DefindexService.buildDeFindexDepositXdr("not-an-address", "10"),
      ).rejects.toMatchObject({
        kind: "validation",
        message: expect.stringContaining("Invalid user address"),
      });
      expect(mockSimulate).not.toHaveBeenCalled();
    });

    it("rejects a contract (C...) address in place of a G... user address", async () => {
      await expect(
        DefindexService.buildDeFindexDepositXdr(VAULT, "10"),
      ).rejects.toMatchObject({ kind: "validation" });
    });
  });

  // ── Configuration ─────────────────────────────────────────────────────────
  describe("configuration errors", () => {
    it("fails with kind=configuration when DEFINDEX_VAULT_CONTRACT_ID is unset", async () => {
      delete process.env.DEFINDEX_VAULT_CONTRACT_ID;

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({ kind: "configuration" });
      expect(mockSimulate).not.toHaveBeenCalled();
    });

    it("fails with kind=configuration when the contract id is malformed", async () => {
      process.env.DEFINDEX_VAULT_CONTRACT_ID = "CNOTAVALIDCONTRACT";

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({ kind: "configuration" });
    });
  });

  // ── Inconsistent / failing vault state ────────────────────────────────────
  describe("vault state errors", () => {
    it("fails when the vault reports no managed assets", async () => {
      mockVaultState({ supply: USDC(1), funds: [] });

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({
        kind: "upstream",
        message: expect.stringContaining("no managed assets"),
      });
      expect(mockDepositToVault).not.toHaveBeenCalled();
    });

    it("fails when funds exist but no shares are in circulation", async () => {
      mockVaultState({ supply: 0n, funds: [fund(USDC(100))] });

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({
        kind: "upstream",
        message: expect.stringContaining("no shares in circulation"),
      });
    });

    it("fails when shares exist but the vault manages no funds", async () => {
      mockVaultState({ supply: USDC(100), funds: [fund(0n)] });

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({
        kind: "upstream",
        message: expect.stringContaining("manages no USDC funds"),
      });
    });

    it("wraps an RPC simulation error response as an upstream error", async () => {
      mockSimulate.mockResolvedValueOnce({ error: "HostError: boom" });

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({
        kind: "upstream",
        message: expect.stringContaining("HostError: boom"),
      });
    });

    it("fails when the simulation has no return value", async () => {
      mockSimulate.mockResolvedValueOnce({ result: {} });

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({ kind: "upstream" });
    });

    it("wraps a rejected RPC call as an upstream error preserving the cause", async () => {
      const cause = new Error("ECONNREFUSED");
      mockSimulate.mockRejectedValueOnce(cause);

      const err = await DefindexService.buildDeFindexDepositXdr(
        USER,
        "10",
      ).catch((e) => e);

      expect(err).toBeInstanceOf(DefindexServiceError);
      expect(err.kind).toBe("upstream");
      expect(err.message).toContain("ECONNREFUSED");
      expect(err.cause).toBe(cause);
    });
  });

  // ── DeFindex SDK failures ─────────────────────────────────────────────────
  describe("DeFindex SDK failures", () => {
    beforeEach(() => {
      mockVaultState({ supply: 0n, funds: [fund(0n)] });
    });

    it("wraps SDK exceptions as upstream errors with the original cause", async () => {
      const cause = new Error("429 Too Many Requests");
      mockDepositToVault.mockRejectedValueOnce(cause);

      const err = await DefindexService.buildDeFindexDepositXdr(
        USER,
        "10",
      ).catch((e) => e);

      expect(err).toBeInstanceOf(DefindexServiceError);
      expect(err.kind).toBe("upstream");
      expect(err.message).toContain("429 Too Many Requests");
      expect(err.cause).toBe(cause);
    });

    it.each([
      ["undefined", undefined],
      ["empty string", ""],
      ["whitespace", "   "],
    ])("fails when the SDK returns %s as the XDR", async (_l, xdr) => {
      mockDepositToVault.mockResolvedValueOnce({
        xdr,
        simulationResponse: {},
      });

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({
        kind: "upstream",
        message: expect.stringContaining("no transaction XDR"),
      });
    });

    it("fails when the SDK returns no simulation response", async () => {
      mockDepositToVault.mockResolvedValueOnce({
        xdr: makeTxXdr().xdr,
        simulationResponse: null,
      });

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({
        kind: "upstream",
        message: expect.stringContaining("no simulation response"),
      });
    });

    it("fails when the SDK returns XDR that cannot be parsed", async () => {
      mockDepositToVault.mockResolvedValueOnce({
        xdr: "this-is-not-xdr",
        simulationResponse: {},
      });

      await expect(
        DefindexService.buildDeFindexDepositXdr(USER, "10"),
      ).rejects.toMatchObject({
        kind: "upstream",
        message: expect.stringContaining("invalid transaction XDR"),
      });
    });
  });
});
