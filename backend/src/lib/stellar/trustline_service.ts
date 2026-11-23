import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

export const DEFAULT_SAVINGS_ASSET_CODE = "USDC";
export const DEFAULT_TRUSTLINE_TIMEOUT_SECONDS = 300;

export type TrustlineErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_ASSET"
  | "INVALID_STELLAR_ADDRESS"
  | "SPONSOR_ACCOUNT_UNAVAILABLE"
  | "TRANSACTION_BUILD_ERROR";

export interface TrustlineAsset {
  code: string;
  issuer: string;
}

export class TrustlineError extends Error {
  constructor(
    message: string,
    public readonly code: TrustlineErrorCode,
    public readonly status: number = 500,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "TrustlineError";
  }
}

export interface BuildSponsoredTrustlineParams {
  /** Contract id (`C...`) of the DeFindex savings vault the user wants to use. */
  vaultContractId: string;
  /** Registered Stellar account (`G...`) of the authenticated user. */
  stellarAddress: string;
  networkPassphrase?: string;
}

export interface SponsoredTrustlineResult {
  /** Unsigned envelope XDR. Must be signed by the user and the sponsor. */
  envelopeXdr: string;
  networkPassphrase: string;
  asset: TrustlineAsset;
  sponsor: string;
  account: string;
  vaultContractId: string;
}

const STELLAR_ADDRESS_PATTERN = /^(G[A-Z2-7]{55})$/;
const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;

function configurationError(message: string, cause?: Error): TrustlineError {
  return new TrustlineError(message, "CONFIGURATION_ERROR", 500, cause);
}

function parseVaultAssetMap(
  env: NodeJS.ProcessEnv,
): Record<string, Partial<TrustlineAsset>> {
  const raw = env.SAVINGS_VAULT_TRUSTLINE_ASSETS;
  if (!raw || raw.trim() === "") {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw configurationError(
      "SAVINGS_VAULT_TRUSTLINE_ASSETS must be valid JSON.",
      error instanceof Error ? error : undefined,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw configurationError(
      "SAVINGS_VAULT_TRUSTLINE_ASSETS must be a JSON object keyed by vault contract id.",
    );
  }

  return parsed as Record<string, Partial<TrustlineAsset>>;
}

function validateAsset(asset: Partial<TrustlineAsset>, source: string): TrustlineAsset {
  const code = typeof asset.code === "string" ? asset.code.trim() : "";
  const issuer = typeof asset.issuer === "string" ? asset.issuer.trim() : "";

  if (!ASSET_CODE_PATTERN.test(code)) {
    throw configurationError(
      `Invalid asset code configured for ${source}. Asset codes must be 1-12 alphanumeric characters.`,
    );
  }

  if (!StrKey.isValidEd25519PublicKey(issuer)) {
    throw configurationError(
      `Invalid asset issuer configured for ${source}. Expected a Stellar public key (G...).`,
    );
  }

  return { code, issuer };
}

/**
 * Resolves the classic asset a savings vault holds.
 *
 * DeFindex vaults are configured in `SAVINGS_VAULT_TRUSTLINE_ASSETS` keyed by
 * vault contract id, because the vault's asset contract (`C...`) does not carry
 * the classic asset code/issuer on-chain. Vaults that are not explicitly listed
 * fall back to the platform's default savings asset (USDC by default).
 */
export function resolveVaultTrustlineAsset(
  vaultContractId: string,
  env: NodeJS.ProcessEnv = process.env,
): TrustlineAsset {
  const configured = parseVaultAssetMap(env)[vaultContractId];

  if (configured) {
    return validateAsset(
      configured,
      `vault ${vaultContractId} in SAVINGS_VAULT_TRUSTLINE_ASSETS`,
    );
  }

  return validateAsset(
    {
      code: env.SAVINGS_TRUSTLINE_ASSET_CODE || DEFAULT_SAVINGS_ASSET_CODE,
      issuer: env.SAVINGS_TRUSTLINE_ASSET_ISSUER || env.STELLAR_USDC_ISSUER,
    },
    "the default savings asset (SAVINGS_TRUSTLINE_ASSET_CODE / STELLAR_USDC_ISSUER)",
  );
}

function resolveNetworkPassphrase(env: NodeJS.ProcessEnv): string {
  return env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
}

function resolveHorizonUrl(env: NodeJS.ProcessEnv, networkPassphrase: string): string {
  if (env.STELLAR_HORIZON_URL) {
    return env.STELLAR_HORIZON_URL;
  }
  if (env.HORIZON_URL) {
    return env.HORIZON_URL;
  }
  return networkPassphrase === Networks.PUBLIC
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

function resolveSponsorKeypair(env: NodeJS.ProcessEnv): Keypair {
  const secret = env.STELLAR_SPONSOR_SECRET;
  if (!secret) {
    throw configurationError(
      "STELLAR_SPONSOR_SECRET is not configured; the platform cannot sponsor trustlines.",
    );
  }

  try {
    return Keypair.fromSecret(secret);
  } catch (error) {
    // Never include the secret itself in the error or the logs.
    throw configurationError(
      "STELLAR_SPONSOR_SECRET is not a valid Stellar secret seed.",
      error instanceof Error ? error : undefined,
    );
  }
}

/**
 * Builds the sponsored `ChangeTrust` envelope a user needs before interacting
 * with a DeFindex savings vault.
 *
 * The transaction is sourced from the platform sponsor account so the sponsor
 * pays the fee, while the `ChangeTrust` and `EndSponsoringFutureReserves`
 * operations are sourced from the user's account, making the sponsor pay the
 * trustline's base reserve until it is revoked. The returned envelope is
 * unsigned: the user signs it first, then the sponsor signs and submits it.
 */
export class TrustlineService {
  constructor(
    private readonly options: {
      env?: NodeJS.ProcessEnv;
      horizonServer?: Horizon.Server;
    } = {},
  ) {}

  resolveAsset(vaultContractId: string): TrustlineAsset {
    return resolveVaultTrustlineAsset(vaultContractId, this.options.env);
  }

  async buildSponsoredTrustline(
    params: BuildSponsoredTrustlineParams,
  ): Promise<SponsoredTrustlineResult> {
    const env = this.options.env ?? process.env;
    const { vaultContractId, stellarAddress } = params;

    if (!StrKey.isValidContract(vaultContractId)) {
      throw new TrustlineError(
        "vaultContractId must be a valid Stellar contract id (C...).",
        "INVALID_ASSET",
        400,
      );
    }

    if (
      !STELLAR_ADDRESS_PATTERN.test(stellarAddress) ||
      !StrKey.isValidEd25519PublicKey(stellarAddress)
    ) {
      throw new TrustlineError(
        "A valid registered Stellar address (G...) is required.",
        "INVALID_STELLAR_ADDRESS",
        400,
      );
    }

    const assetConfig = resolveVaultTrustlineAsset(vaultContractId, env);
    const networkPassphrase = params.networkPassphrase ?? resolveNetworkPassphrase(env);
    const sponsorKeypair = resolveSponsorKeypair(env);
    const sponsorPublicKey = sponsorKeypair.publicKey();
    const server =
      this.options.horizonServer ??
      new Horizon.Server(resolveHorizonUrl(env, networkPassphrase));

    let sponsorAccount;
    try {
      // Re-read the sponsor sequence for every request so back-to-back
      // envelopes stay submittable.
      sponsorAccount = await server.loadAccount(sponsorPublicKey);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new TrustlineError(
        "Unable to load the platform sponsor account from Horizon.",
        "SPONSOR_ACCOUNT_UNAVAILABLE",
        502,
        err,
      );
    }

    try {
      const asset = new Asset(assetConfig.code, assetConfig.issuer);

      const transaction = new TransactionBuilder(sponsorAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(
          Operation.beginSponsoringFutureReserves({
            sponsoredId: stellarAddress,
          }),
        )
        .addOperation(
          Operation.changeTrust({
            asset,
            source: stellarAddress,
          }),
        )
        .addOperation(
          Operation.endSponsoringFutureReserves({
            source: stellarAddress,
          }),
        )
        .setTimeout(DEFAULT_TRUSTLINE_TIMEOUT_SECONDS)
        .build();

      return {
        envelopeXdr: transaction.toXDR(),
        networkPassphrase,
        asset: assetConfig,
        sponsor: sponsorPublicKey,
        account: stellarAddress,
        vaultContractId,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new TrustlineError(
        "Failed to build the sponsored trustline transaction.",
        "TRANSACTION_BUILD_ERROR",
        500,
        err,
      );
    }
  }
}

export default TrustlineService;
