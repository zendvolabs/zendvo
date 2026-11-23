import {
  FeeBumpTransaction,
  Networks,
  TransactionBuilder,
  rpc,
  type Transaction,
} from "@stellar/stellar-sdk";

const RPC_TIMEOUT_MS = 15 * 1000;

/** Maximum submission attempts, including the first try. */
export const MAX_SUBMISSION_ATTEMPTS = 5;

const DEFAULT_BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8 * 1000;

export type SubmissionStatus = "pending" | "success";

export interface SubmissionResult {
  hash: string;
  status: SubmissionStatus;
  attempts: number;
}

/** Thrown when a signed envelope cannot be submitted to the network. */
export class SubmissionError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "SubmissionError";
  }
}

/**
 * Resolves the configured Soroban RPC endpoint.
 * Mirrors the convention in src/jobs/transaction_verifier.ts.
 */
export function getRpcUrl(): string {
  const rpcUrl = process.env.SOROBAN_RPC_URL || process.env.STELLAR_RPC_URL;
  if (!rpcUrl) {
    throw new Error(
      "SOROBAN_RPC_URL or STELLAR_RPC_URL must be configured for transaction submission",
    );
  }
  return rpcUrl;
}

/** Resolves the network passphrase, mirroring src/lib/soroban.ts. */
export function getNetworkPassphrase(): string {
  return process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
}

/**
 * Parses a client-signed transaction envelope. Throws when the XDR is
 * malformed or was built for a different network.
 */
export function parseSignedXdr(
  signedXdr: string,
  networkPassphrase: string = getNetworkPassphrase(),
): Transaction | FeeBumpTransaction {
  return TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
}

/**
 * Returns the source account of a parsed envelope. For a fee-bump envelope
 * the fee source pays the fee, but the transaction's own source account is
 * the inner transaction's source.
 */
export function getEnvelopeSourceAccount(
  transaction: Transaction | FeeBumpTransaction,
): string {
  if (transaction instanceof FeeBumpTransaction) {
    return transaction.innerTransaction.source;
  }
  return transaction.source;
}

export interface SubmissionServiceOptions {
  /** Override the RPC server (used by tests to avoid network calls). */
  server?: Pick<rpc.Server, "sendTransaction">;
  /** Maximum attempts including the first try (default 5). */
  maxAttempts?: number;
  /** Delay before the first retry; doubles after each attempt (default 500ms). */
  baseDelayMs?: number;
  /** Injectable clock for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Submits client-signed transaction envelopes to the Stellar/Soroban RPC
 * network.
 *
 * A submission is retried with exponential backoff when the network is
 * unreachable or the RPC node asks to try again later. A submission the
 * network rejects outright (status ERROR) is terminal: retrying the same
 * envelope cannot succeed, so it fails immediately.
 */
export class SubmissionService {
  private readonly serverOverride?: Pick<rpc.Server, "sendTransaction">;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private sharedServer: rpc.Server | null = null;

  constructor(options: SubmissionServiceOptions = {}) {
    this.serverOverride = options.server;
    this.maxAttempts = options.maxAttempts ?? MAX_SUBMISSION_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private getServer(): Pick<rpc.Server, "sendTransaction"> {
    if (this.serverOverride) {
      return this.serverOverride;
    }
    if (!this.sharedServer) {
      this.sharedServer = new rpc.Server(getRpcUrl(), {
        timeout: RPC_TIMEOUT_MS,
      });
    }
    return this.sharedServer;
  }

  /**
   * Submits a signed XDR envelope to Soroban RPC with exponential backoff
   * and retry handling (up to 5 attempts).
   *
   * Returns the network transaction hash and the submission status. The
   * status is "pending" while the transaction awaits confirmation on
   * ledger; the transaction verifier job reconciles pending submissions
   * afterwards. The "success" status is reserved for a confirmed
   * submission.
   */
  async submitXdrToNetwork(signedXdr: string): Promise<SubmissionResult> {
    const transaction = parseSignedXdr(signedXdr);
    // Resolve the server up front so a missing RPC configuration fails
    // immediately instead of being retried as a transient error.
    const server = this.getServer();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await server.sendTransaction(transaction);

        if (response.status === "PENDING" || response.status === "DUPLICATE") {
          // DUPLICATE means the network already holds this exact envelope.
          return { hash: response.hash, status: "pending", attempts: attempt };
        }

        if (response.status === "TRY_AGAIN_LATER") {
          lastError = new Error(
            "Soroban RPC asked to try submitting again later",
          );
        } else {
          // ERROR: the network rejected the envelope; retrying the same
          // XDR will not help.
          throw new SubmissionError(
            `Soroban RPC rejected the transaction: ${response.status}`,
            attempt,
          );
        }
      } catch (error) {
        if (error instanceof SubmissionError) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < this.maxAttempts) {
        await this.sleep(
          Math.min(this.baseDelayMs * 2 ** (attempt - 1), MAX_DELAY_MS),
        );
      }
    }

    throw new SubmissionError(
      `Failed to submit transaction to the Stellar network after ${this.maxAttempts} attempts`,
      this.maxAttempts,
      lastError,
    );
  }
}

/**
 * Default shared service instance used by the API route. The RPC server is
 * created lazily on first use, so importing this module never throws when
 * the RPC URL is not configured.
 */
export const submissionService = new SubmissionService();
