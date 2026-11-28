import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { DefindexSDK, SupportedNetworks } from "@defindex/sdk";

/**
 * DeFindex / Soroban savings-vault integration.
 *
 * Responsibilities:
 *  - Read the caller's on-chain vault position (dfTokens + underlying) from the
 *    DeFindex API/SDK so we never trust a client-supplied balance.
 *  - Convert the requested withdrawal amount into the number of vault shares
 *    that must be burned, using the user's own share/underlying ratio.
 *  - Apply the caller's slippage tolerance as `min_amounts_out`.
 *  - Build (and, when an RPC endpoint is available, simulate) the unsigned
 *    `withdraw` contract invocation for the client to sign.
 *
 * DeFindex vault ABI (vault contract):
 *   withdraw(df_amount: i128, min_amounts_out: Vec<i128>, from: Address) -> Vec<i128>
 */

/** Savings vault assets (USDC) use 7 decimals, as do Stellar stroops. */
export const VAULT_ASSET_DECIMALS = 7;
const STROOPS_PER_UNIT = 10n ** BigInt(VAULT_ASSET_DECIMALS);

/** Basis points denominator (1% = 100 bps). */
export const BPS_DENOMINATOR = 10_000n;

/** Default slippage tolerance: 1%. */
export const DEFAULT_SLIPPAGE_BPS = 100;

/** Upper bound accepted for slippage: 50%. */
export const MAX_SLIPPAGE_BPS = 5_000;

export type DefindexErrorCode =
  | "DEFINDEX_NOT_CONFIGURED"
  | "VAULT_NOT_CONFIGURED"
  | "INVALID_AMOUNT"
  | "INVALID_ADDRESS"
  | "INVALID_SLIPPAGE"
  | "INSUFFICIENT_VAULT_SHARES"
  | "DEFINDEX_UPSTREAM_ERROR"
  | "SIMULATION_FAILED"
  | "XDR_BUILD_FAILED";

export class DefindexServiceError extends Error {
  constructor(
    message: string,
    public readonly code: DefindexErrorCode,
    public readonly status: number = 400,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DefindexServiceError";
  }
}

export interface VaultPosition {
  /** Vault shares (dfTokens) held by the user, in the vault's smallest unit. */
  shares: bigint;
  /** Underlying asset value of those shares, in the asset's smallest unit. */
  underlying: bigint;
  /** Number of assets in the vault; `min_amounts_out` has this length. */
  assetCount: number;
}

export interface WithdrawalPlan {
  amountStroops: bigint;
  sharesToBurn: bigint;
  /** Underlying the user should receive, in the asset's smallest unit. */
  expectedUnderlying: bigint;
  /** One entry per vault asset, in the vault's asset order. */
  minAmountsOut: bigint[];
  slippageBps: number;
  /** Underlying units per share, scaled by 10^7 (string to stay JSON-safe). */
  sharePrice: string;
}

export interface WithdrawalXdrParams {
  vaultContractId: string;
  userAddress: string;
  amount: string | number;
  /** Slippage tolerance in basis points. Defaults to 1%. */
  slippageBps?: number;
}

export interface WithdrawalXdrResult extends WithdrawalPlan {
  unsignedXdr: string;
  vaultContractId: string;
  network: SupportedNetworks;
  simulated: boolean;
}

export interface DefindexServiceOptions {
  sdk?: DefindexSDK;
  network?: SupportedNetworks;
  networkPassphrase?: string;
  rpcUrl?: string;
  /** Set to false to skip RPC simulation (e.g. offline/dev environments). */
  simulate?: boolean;
}

function envNetwork(): SupportedNetworks {
  const configured = (
    process.env.STELLAR_NETWORK ||
    process.env.STELLAR_NETWORK_NAME ||
    "testnet"
  ).toLowerCase();

  return configured === "mainnet" || configured === "public"
    ? SupportedNetworks.MAINNET
    : SupportedNetworks.TESTNET;
}

function defaultRpcUrl(network: SupportedNetworks): string {
  return network === SupportedNetworks.MAINNET
    ? "https://soroban.stellar.org"
    : "https://soroban-testnet.stellar.org";
}

/** Parses a positive decimal amount of vault asset units into smallest units. */
export function amountToStroops(amount: string | number): bigint {
  const raw = typeof amount === "number" ? String(amount) : amount.trim();

  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new DefindexServiceError(
      "amount must be a positive decimal number",
      "INVALID_AMOUNT",
      400,
    );
  }

  const [wholePart, fractionPart = ""] = raw.split(".");

  if (fractionPart.length > VAULT_ASSET_DECIMALS) {
    throw new DefindexServiceError(
      `amount must have at most ${VAULT_ASSET_DECIMALS} decimal places`,
      "INVALID_AMOUNT",
      400,
    );
  }

  const paddedFraction = fractionPart.padEnd(VAULT_ASSET_DECIMALS, "0");
  const stroops =
    BigInt(wholePart) * STROOPS_PER_UNIT + BigInt(paddedFraction || "0");

  if (stroops <= 0n) {
    throw new DefindexServiceError(
      "amount must be greater than zero",
      "INVALID_AMOUNT",
      400,
    );
  }

  return stroops;
}

function toBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new DefindexServiceError(
        `DeFindex returned an invalid ${label}`,
        "DEFINDEX_UPSTREAM_ERROR",
        502,
      );
    }
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }

  throw new DefindexServiceError(
    `DeFindex returned an invalid ${label}`,
    "DEFINDEX_UPSTREAM_ERROR",
    502,
  );
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

export class DefindexService {
  private readonly sdk?: DefindexSDK;
  private readonly network: SupportedNetworks;
  private readonly networkPassphrase: string;
  private readonly rpcUrl?: string;
  private readonly simulate: boolean;

  constructor(options: DefindexServiceOptions = {}) {
    this.network = options.network ?? envNetwork();
    this.networkPassphrase =
      options.networkPassphrase ??
      process.env.STELLAR_NETWORK_PASSPHRASE ??
      (this.network === SupportedNetworks.MAINNET
        ? Networks.PUBLIC
        : Networks.TESTNET);
    this.sdk = options.sdk ?? this.createSdk();
    this.simulate =
      options.simulate ??
      (process.env.DEFINDEX_SKIP_SIMULATION !== "true" &&
        process.env.STELLAR_SKIP_SIMULATION !== "true");
    this.rpcUrl =
      options.rpcUrl ??
      process.env.SOROBAN_RPC_URL ??
      process.env.STELLAR_RPC_URL ??
      (this.simulate ? defaultRpcUrl(this.network) : undefined);
  }

  private createSdk(): DefindexSDK | undefined {
    const apiKey = process.env.DEFINDEX_API_KEY;
    if (!apiKey) return undefined;

    return new DefindexSDK({
      apiKey,
      baseUrl: process.env.DEFINDEX_API_BASE_URL || "https://api.defindex.io",
      timeout: Number(process.env.DEFINDEX_API_TIMEOUT_MS) || 15_000,
      defaultNetwork: this.network,
    });
  }

  getNetwork(): SupportedNetworks {
    return this.network;
  }

  /** Reads the caller's vault shares and underlying balance from DeFindex. */
  async getVaultPosition(
    vaultContractId: string,
    userAddress: string,
  ): Promise<VaultPosition> {
    if (!this.sdk) {
      throw new DefindexServiceError(
        "Savings vault is not configured: DEFINDEX_API_KEY is missing",
        "DEFINDEX_NOT_CONFIGURED",
        503,
      );
    }

    let balance;
    try {
      balance = await this.sdk.getVaultBalance(
        vaultContractId,
        userAddress,
        this.network,
      );
    } catch (error) {
      throw new DefindexServiceError(
        "Unable to read the savings vault balance from DeFindex",
        "DEFINDEX_UPSTREAM_ERROR",
        502,
        error,
      );
    }

    const shares = toBigInt(balance?.dfTokens ?? 0, "dfTokens");
    const underlyingBalances = Array.isArray(balance?.underlyingBalance)
      ? balance.underlyingBalance
      : [];

    if (underlyingBalances.length > 1) {
      throw new DefindexServiceError(
        "This vault holds multiple assets; withdrawals are only supported for single-asset savings vaults",
        "VAULT_NOT_CONFIGURED",
        400,
      );
    }

    const underlying =
      underlyingBalances.length === 1
        ? toBigInt(underlyingBalances[0], "underlyingBalance")
        : 0n;

    return {
      shares,
      underlying,
      assetCount: Math.max(underlyingBalances.length, 1),
    };
  }

  /**
   * Converts an underlying amount into shares to burn and the minimum
   * acceptable output given the user's slippage tolerance.
   *
   * shares = ceil(amount * userShares / userUnderlying)
   * minOut = amount - amount * slippageBps / 10_000
   */
  planWithdrawal(
    amountStroops: bigint,
    position: VaultPosition,
    slippageBps: number = DEFAULT_SLIPPAGE_BPS,
  ): WithdrawalPlan {
    if (
      !Number.isInteger(slippageBps) ||
      slippageBps < 0 ||
      slippageBps > MAX_SLIPPAGE_BPS
    ) {
      throw new DefindexServiceError(
        `slippageBps must be an integer between 0 and ${MAX_SLIPPAGE_BPS}`,
        "INVALID_SLIPPAGE",
        400,
      );
    }

    if (position.shares <= 0n || position.underlying <= 0n) {
      throw new DefindexServiceError(
        "Insufficient vault shares for this withdrawal",
        "INSUFFICIENT_VAULT_SHARES",
        422,
      );
    }

    if (amountStroops > position.underlying) {
      throw new DefindexServiceError(
        "Requested amount exceeds the user's vault share balance",
        "INSUFFICIENT_VAULT_SHARES",
        422,
      );
    }

    const sharesToBurn = ceilDiv(amountStroops * position.shares, position.underlying);

    if (sharesToBurn > position.shares) {
      throw new DefindexServiceError(
        "Requested amount exceeds the user's vault share balance",
        "INSUFFICIENT_VAULT_SHARES",
        422,
      );
    }

    const slippageAllowance =
      (amountStroops * BigInt(slippageBps)) / BPS_DENOMINATOR;
    const minAmountOut = amountStroops - slippageAllowance;

    const minAmountsOut = new Array<bigint>(position.assetCount).fill(0n);
    minAmountsOut[0] = minAmountOut;

    const sharePrice =
      (position.underlying * STROOPS_PER_UNIT) / position.shares;

    return {
      amountStroops,
      sharesToBurn,
      expectedUnderlying: amountStroops,
      minAmountsOut,
      slippageBps,
      sharePrice: sharePrice.toString(),
    };
  }

  /** Builds (and simulates, when possible) the unsigned withdraw XDR. */
  async buildWithdrawalXdr(
    params: WithdrawalXdrParams,
  ): Promise<WithdrawalXdrResult> {
    const { vaultContractId, userAddress, amount } = params;

    if (!StrKey.isValidContract(vaultContractId)) {
      throw new DefindexServiceError(
        "The savings vault contract address is invalid or not configured",
        "VAULT_NOT_CONFIGURED",
        500,
      );
    }

    if (!StrKey.isValidEd25519PublicKey(userAddress)) {
      throw new DefindexServiceError(
        "address must be a valid Stellar public key",
        "INVALID_ADDRESS",
        400,
      );
    }

    const amountStroops = amountToStroops(amount);
    const position = await this.getVaultPosition(vaultContractId, userAddress);
    const plan = this.planWithdrawal(
      amountStroops,
      position,
      params.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    );

    const operation = new Contract(vaultContractId).call(
      "withdraw",
      nativeToScVal(plan.sharesToBurn, { type: "i128" }),
      nativeToScVal(plan.minAmountsOut, { type: "i128" }),
      Address.fromString(userAddress).toScVal(),
    );

    let unsignedXdr: string;
    let simulated = false;

    try {
      const server = this.createRpcServer();

      if (server) {
        const sourceAccount = await server.getAccount(userAddress);
        const transaction = new TransactionBuilder(sourceAccount, {
          fee: BASE_FEE,
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(operation)
          .setTimeout(60)
          .build();

        const prepared = await server.prepareTransaction(transaction);
        unsignedXdr = prepared.toXDR();
        simulated = true;
      } else {
        unsignedXdr = this.buildUnsimulatedXdr(operation, userAddress);
      }
    } catch (error) {
      if (error instanceof DefindexServiceError) throw error;

      throw new DefindexServiceError(
        "Failed to simulate the withdrawal transaction",
        "SIMULATION_FAILED",
        502,
        error,
      );
    }

    return {
      ...plan,
      unsignedXdr,
      vaultContractId,
      network: this.network,
      simulated,
    };
  }

  private createRpcServer(): rpc.Server | undefined {
    if (!this.simulate || !this.rpcUrl) return undefined;

    return new rpc.Server(this.rpcUrl, {
      allowHttp: this.rpcUrl.startsWith("http://"),
    });
  }

  /**
   * Fallback used when simulation is disabled or no RPC endpoint is
   * configured. The envelope still carries the correct contract invocation and
   * arguments, but the client must simulate/prepare it before submitting.
   */
  private buildUnsimulatedXdr(
    operation: ReturnType<Contract["call"]>,
    userAddress: string,
  ): string {
    return new TransactionBuilder(new Account(userAddress, "0"), {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(60)
      .build()
      .toXDR();
  }
}

export const defindexService = new DefindexService();
export default defindexService;
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
