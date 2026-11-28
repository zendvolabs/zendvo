import {
  Horizon,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

export const DEFAULT_ACTIVATION_STARTING_BALANCE = "1";
export const ACTIVATION_TIMEOUT_SECONDS = 300;

export type ActivationErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_STELLAR_ADDRESS"
  | "INVALID_STARTING_BALANCE"
  | "ACCOUNT_ALREADY_ACTIVE"
  | "HORIZON_UNAVAILABLE"
  | "TRANSACTION_BUILD_ERROR";

export class ActivationError extends Error {
  constructor(
    message: string,
    public readonly code: ActivationErrorCode,
    public readonly status: number = 500,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "ActivationError";
  }
}

export interface BuildCreateAccountParams {
  /** Stellar public key (`G...`) of the freshly generated account. */
  destination: string;
  /** XLM to fund the account with. Defaults to the minimum base reserve. */
  startingBalance?: string;
  networkPassphrase?: string;
}

export interface CreateAccountResult {
  /** Unsigned envelope XDR. The platform funding account must sign it. */
  envelopeXdr: string;
  networkPassphrase: string;
  source: string;
  destination: string;
  startingBalance: string;
}

function resolveNetworkPassphrase(env: NodeJS.ProcessEnv): string {
  return env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
}

function resolveHorizonUrl(env: NodeJS.ProcessEnv, passphrase: string): string {
  if (env.STELLAR_HORIZON_URL) return env.STELLAR_HORIZON_URL;
  if (env.HORIZON_URL) return env.HORIZON_URL;
  return passphrase === Networks.PUBLIC
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

function isNotFound(error: unknown): boolean {
  const e = error as { response?: { status?: number }; status?: number };
  return e?.response?.status === 404 || e?.status === 404;
}

function validStartingBalance(value: string): boolean {
  return /^\d+(\.\d{1,7})?$/.test(value) && Number(value) > 0;
}

/**
 * Builds the unsigned `CreateAccount` envelope that activates a new,
 * non-custodial Stellar account. The platform funding account (the sponsor
 * secret) is the transaction source and pays the fee; it signs afterwards.
 */
export class TransactionBuilderService {
  constructor(
    private readonly options: {
      env?: NodeJS.ProcessEnv;
      horizonServer?: Pick<Horizon.Server, "loadAccount">;
    } = {},
  ) {}

  async buildCreateAccount(
    params: BuildCreateAccountParams,
  ): Promise<CreateAccountResult> {
    const env = this.options.env ?? process.env;
    const destination = (params.destination ?? "").trim();

    if (!StrKey.isValidEd25519PublicKey(destination)) {
      throw new ActivationError(
        "A valid Stellar public key (G...) is required.",
        "INVALID_STELLAR_ADDRESS",
        400,
      );
    }

    const startingBalance =
      params.startingBalance ??
      env.STELLAR_ACTIVATION_STARTING_BALANCE ??
      DEFAULT_ACTIVATION_STARTING_BALANCE;
    if (!validStartingBalance(startingBalance)) {
      throw new ActivationError(
        "Starting balance must be a positive amount with at most 7 decimals.",
        "INVALID_STARTING_BALANCE",
        env.STELLAR_ACTIVATION_STARTING_BALANCE === startingBalance ? 500 : 400,
      );
    }

    const secret = env.STELLAR_SPONSOR_SECRET;
    if (!secret) {
      throw new ActivationError(
        "STELLAR_SPONSOR_SECRET is not configured; the platform cannot fund new accounts.",
        "CONFIGURATION_ERROR",
        500,
      );
    }
    let sourcePublicKey: string;
    try {
      sourcePublicKey = Keypair.fromSecret(secret).publicKey();
    } catch (error) {
      // Never include the secret in the error.
      throw new ActivationError(
        "STELLAR_SPONSOR_SECRET is not a valid Stellar secret seed.",
        "CONFIGURATION_ERROR",
        500,
        error instanceof Error ? error : undefined,
      );
    }

    const networkPassphrase =
      params.networkPassphrase ?? resolveNetworkPassphrase(env);
    const server =
      this.options.horizonServer ??
      new Horizon.Server(resolveHorizonUrl(env, networkPassphrase));

    // CreateAccount fails on-chain if the account already exists.
    try {
      await server.loadAccount(destination);
      throw new ActivationError(
        "This Stellar account is already active.",
        "ACCOUNT_ALREADY_ACTIVE",
        409,
      );
    } catch (error) {
      if (error instanceof ActivationError) throw error;
      if (!isNotFound(error)) {
        throw new ActivationError(
          "Unable to check the account status on Horizon.",
          "HORIZON_UNAVAILABLE",
          502,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    let sourceAccount;
    try {
      sourceAccount = await server.loadAccount(sourcePublicKey);
    } catch (error) {
      throw new ActivationError(
        "Unable to load the platform funding account from Horizon.",
        "HORIZON_UNAVAILABLE",
        502,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    try {
      const transaction = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(Operation.createAccount({ destination, startingBalance }))
        .setTimeout(ACTIVATION_TIMEOUT_SECONDS)
        .build();

      return {
        envelopeXdr: transaction.toXDR(),
        networkPassphrase,
        source: sourcePublicKey,
        destination,
        startingBalance,
      };
    } catch (error) {
      throw new ActivationError(
        "Failed to build the account activation transaction.",
        "TRANSACTION_BUILD_ERROR",
        500,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

export default TransactionBuilderService;
