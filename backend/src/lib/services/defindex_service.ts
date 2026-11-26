import { DefindexSDK, SupportedNetworks } from "@defindex/sdk";
import {
  Account,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

export interface DepositTransaction {
  xdr: string;
  fee: string | null;
  resourceFee: string | null;
  simulation: unknown;
}

export interface SharePriceSnapshot {
  sharePrice: number;
  recordedAt: Date | string;
}

export interface VaultDashboardMetrics {
  vaultBalance: number;
  shareBalance: number;
  sharePrice: number;
  apy: {
    rate: number;
    formatted: string;
  };
}

export class DefindexServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "DefindexServiceError";
    this.status = status;
    this.code = code;
  }
}

const ONE_SHARE_IN_STROOPS = 10_000_000n;
const SHARE_PRICE_KEYS = [
  "sharePrice",
  "pricePerShare",
  "currentSharePrice",
  "sharePriceStroops",
];
const APY_KEYS = ["apy", "apyPercent", "rate", "annualPercentageYield"];
const BALANCE_KEYS = ["dfTokens", "shares", "shareBalance"];

function resolveNetwork(): SupportedNetworks {
  return (process.env.STELLAR_NETWORK || "testnet").toLowerCase() === "mainnet"
    ? SupportedNetworks.MAINNET
    : SupportedNetworks.TESTNET;
}

function resolveNetworkPassphrase(): string {
  if (process.env.STELLAR_NETWORK_PASSPHRASE) {
    return process.env.STELLAR_NETWORK_PASSPHRASE;
  }
  return resolveNetwork() === SupportedNetworks.MAINNET
    ? Networks.PUBLIC
    : Networks.TESTNET;
}

function createSdk(): DefindexSDK {
  const apiKey = process.env.DEFINDEX_API_KEY;
  if (!apiKey) {
    throw new DefindexServiceError(
      "DeFindex API key is not configured",
      503,
      "DEFINDEX_NOT_CONFIGURED",
    );
  }

  return new DefindexSDK({
    apiKey,
    ...(process.env.DEFINDEX_API_URL
      ? { baseUrl: process.env.DEFINDEX_API_URL }
      : {}),
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickNumber(source: unknown, keys: string[]): number | null {
  const record = asRecord(source);
  if (!record) return null;

  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) return value;
  }

  const nested = asRecord(record.data);
  if (nested) {
    for (const key of keys) {
      const value = toNumber(nested[key]);
      if (value !== null) return value;
    }
  }

  return null;
}

function extractSharePrice(source: unknown): number | null {
  const price = pickNumber(source, SHARE_PRICE_KEYS);
  return price !== null && price > 0 ? price : null;
}

function extractApy(source: unknown): number | null {
  const direct = pickNumber(source, APY_KEYS);
  if (direct !== null) return direct;

  const record = asRecord(source);
  return record ? pickNumber(record.apy, ["rate", "apy", "apyPercent"]) : null;
}

function toTimestamp(value: Date | string): number {
  const timestamp = value instanceof Date
    ? value.getTime()
    : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

export function estimateApyFromSharePrices(
  snapshots: SharePriceSnapshot[],
): number | null {
  const points = snapshots
    .map((snapshot) => ({
      price: toNumber(snapshot.sharePrice),
      time: toTimestamp(snapshot.recordedAt),
    }))
    .filter(
      (point): point is { price: number; time: number } =>
        point.price !== null && point.price > 0 && Number.isFinite(point.time),
    )
    .sort((a, b) => a.time - b.time);

  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const elapsedDays = (last.time - first.time) / 86_400_000;
  if (elapsedDays <= 0) return null;

  const growth = last.price / first.price;
  if (growth <= 0) return null;

  const rate = (Math.pow(growth, 365 / elapsedDays) - 1) * 100;
  return Number.isFinite(rate) ? Number(rate.toFixed(2)) : null;
}

async function readSharePriceFromRpc(options: {
  vaultAddress: string;
  caller: string;
}): Promise<number | null> {
  const rpcUrl = process.env.SOROBAN_RPC_URL || process.env.STELLAR_RPC_URL;
  if (!rpcUrl) return null;

  const transaction = new TransactionBuilder(
    new Account(options.caller, "0"),
    {
      fee: "100",
      networkPassphrase: resolveNetworkPassphrase(),
    },
  )
    .addOperation(
      Operation.invokeContractFunction({
        contract: options.vaultAddress,
        function: "get_asset_amounts_per_shares",
        args: [nativeToScVal(ONE_SHARE_IN_STROOPS, { type: "i128" })],
      }),
    )
    .setTimeout(30)
    .build();

  const simulation = await new rpc.Server(rpcUrl).simulateTransaction(
    transaction,
  );
  if (rpc.Api.isSimulationError(simulation) || !simulation.result) return null;

  const native = scValToNative(simulation.result.retval) as unknown;
  const amounts = Array.isArray(native) ? native : [native];
  const perShareAmount = amounts
    .map(toNumber)
    .find((value): value is number => value !== null && value > 0);

  return perShareAmount === undefined
    ? null
    : perShareAmount / Number(ONE_SHARE_IN_STROOPS);
}

export async function getVaultDashboardMetrics(options: {
  vaultAddress: string;
  stellarAddress: string;
  sharePriceHistory?: SharePriceSnapshot[];
}): Promise<VaultDashboardMetrics> {
  const sdk = createSdk();
  const network = resolveNetwork();

  const [infoResult, balanceResult, apyResult] = await Promise.allSettled([
    sdk.getVaultInfo(options.vaultAddress, network),
    sdk.getVaultBalance(options.vaultAddress, options.stellarAddress, network),
    sdk.getVaultAPY(options.vaultAddress, network),
  ]);

  if (balanceResult.status === "rejected") {
    console.error("[DEFINDEX_VAULT_BALANCE_ERROR]", balanceResult.reason);
    throw new DefindexServiceError(
      "Unable to load the vault balance from DeFindex.",
      502,
      "VAULT_BALANCE_UNAVAILABLE",
    );
  }

  const balance = balanceResult.value;
  const info = infoResult.status === "fulfilled" ? infoResult.value : null;
  const apyResponse = apyResult.status === "fulfilled" ? apyResult.value : null;
  const history = options.sharePriceHistory ?? [];

  const shareBalance = Math.max(0, pickNumber(balance, BALANCE_KEYS) ?? 0);
  const rawUnderlying = asRecord(balance)?.underlyingBalance;
  const underlyingValues = Array.isArray(rawUnderlying)
    ? rawUnderlying
        .map(toNumber)
        .filter((value): value is number => value !== null && value > 0)
    : [];
  const vaultBalance = Math.max(
    0,
    pickNumber(balance, ["underlyingBalance", "balance", "vaultBalance"]) ??
      underlyingValues[0] ??
      0,
  );

  let sharePrice = extractSharePrice(balance) ?? extractSharePrice(info);
  if (sharePrice === null && shareBalance > 0 && vaultBalance > 0) {
    sharePrice = vaultBalance / shareBalance;
  }
  if (sharePrice === null) {
    try {
      sharePrice = await readSharePriceFromRpc({
        vaultAddress: options.vaultAddress,
        caller: options.stellarAddress,
      });
    } catch (error) {
      console.error("[DEFINDEX_SHARE_PRICE_RPC_ERROR]", error);
    }
  }
  if (sharePrice === null) {
    const latest = history
      .map((snapshot) => toNumber(snapshot.sharePrice))
      .filter((price): price is number => price !== null && price > 0)
      .pop();
    sharePrice = latest ?? 0;
  }

  const apyRate =
    extractApy(apyResponse) ??
    extractApy(info) ??
    estimateApyFromSharePrices(history) ??
    0;

  return {
    vaultBalance,
    shareBalance,
    sharePrice,
    apy: {
      rate: apyRate,
      formatted: `${apyRate.toFixed(2)}%`,
    },
  };
}

/** Builds and simulates an unsigned DeFindex vault deposit transaction. */
export async function buildDepositTransaction(options: {
  vaultAddress: string;
  caller: string;
  amount: bigint;
}): Promise<DepositTransaction> {
  const sdk = createSdk();
  const network = resolveNetwork();
  const supportedNetwork =
    network === SupportedNetworks.MAINNET
      ? SupportedNetworks.MAINNET
      : SupportedNetworks.TESTNET;

  const response = await sdk.depositToVault(
    options.vaultAddress,
    {
      amounts: [Number(options.amount)],
      caller: options.caller,
      invest: true,
      slippageBps: Number(process.env.DEFINDEX_DEPOSIT_SLIPPAGE_BPS || 100),
    },
    supportedNetwork,
  );

  const result = response;
  if (!result.xdr) {
    throw new Error("DeFindex did not return an unsigned deposit transaction XDR");
  }
  const networkPassphrase = resolveNetworkPassphrase();
  const rpcUrl = process.env.SOROBAN_RPC_URL || process.env.STELLAR_RPC_URL;
  if (!rpcUrl) throw new Error("SOROBAN_RPC_URL or STELLAR_RPC_URL must be configured");

  const transaction = TransactionBuilder.fromXDR(result.xdr, networkPassphrase);
  const simulation = await new rpc.Server(rpcUrl).simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Soroban deposit simulation failed: ${simulation.error}`);
  }
  return {
    xdr: result.xdr,
    fee: transaction.fee,
    resourceFee: simulation.minResourceFee ?? null,
    simulation: result.simulationResponse ?? null,
  };
}
