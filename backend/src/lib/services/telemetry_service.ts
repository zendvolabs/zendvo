import { randomUUID } from "crypto";

export type LogLevel = "info" | "warn" | "error" | "debug";

export type LifecycleStage =
  | "xdr_generation"
  | "network_submission"
  | "transaction_confirmation";

export type LifecycleStatus = "started" | "completed" | "failed";

export type SavingsTransactionType =
  | "deposit"
  | "withdrawal"
  | "trustline"
  | "activation"
  | "blockchain_submission"
  | string;

export interface TelemetryLog {
  timestamp: string;
  level: LogLevel;
  service: string;
  event: string;
  stage?: LifecycleStage;
  status?: LifecycleStatus;
  traceId?: string;
  userId?: string;
  transactionType?: SavingsTransactionType;
  amount?: string | number;
  currency?: string;
  stellarAddress?: string;
  txHash?: string;
  durationMs?: number;
  attempts?: number;
  errorCode?: string | number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface XdrGenerationLogParams {
  traceId?: string;
  userId?: string;
  transactionType: SavingsTransactionType;
  amount?: string | number;
  currency?: string;
  stellarAddress?: string;
  durationMs?: number;
  txHash?: string;
  error?: unknown;
  errorMessage?: string;
  errorCode?: string | number;
  metadata?: Record<string, unknown>;
}

export interface SubmissionLogParams {
  traceId?: string;
  userId?: string;
  transactionType?: SavingsTransactionType;
  stellarAddress?: string;
  txHash?: string;
  durationMs?: number;
  attempts?: number;
  error?: unknown;
  errorMessage?: string;
  errorCode?: string | number;
  metadata?: Record<string, unknown>;
}

export interface ConfirmationLogParams {
  traceId?: string;
  userId?: string;
  transactionType?: SavingsTransactionType;
  amount?: string | number;
  currency?: string;
  vaultContractId?: string;
  txHash?: string;
  durationMs?: number;
  error?: unknown;
  errorMessage?: string;
  errorCode?: string | number;
  metadata?: Record<string, unknown>;
}

/**
 * Regex matching Stellar ed25519 secret seed keys (RFC 4648 base32 string starting with 'S' and 56 characters long).
 */
const STELLAR_SECRET_SEED_REGEX = /\bS[A-Z2-7]{55}\b/g;

/**
 * Key patterns that should be redacted from metadata/logs.
 */
const SENSITIVE_KEY_REGEX =
  /(secret|private|seed|mnemonic|password|token|auth|cookie|keypair|credential|pin)/i;

/**
 * Recursively sanitizes any value, stripping or masking sensitive keys,
 * passwords, auth headers, and Stellar secret keys.
 */
export function sanitizeLogData(data: unknown, visited = new WeakSet()): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    // Redact any Stellar secret seed appearing anywhere in strings
    return data.replace(STELLAR_SECRET_SEED_REGEX, "[REDACTED_STELLAR_SECRET]");
  }

  if (typeof data === "number" || typeof data === "boolean" || typeof data === "bigint") {
    return data;
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: (data.message || "").replace(
        STELLAR_SECRET_SEED_REGEX,
        "[REDACTED_STELLAR_SECRET]"
      ),
      stack: data.stack
        ? data.stack.replace(STELLAR_SECRET_SEED_REGEX, "[REDACTED_STELLAR_SECRET]")
        : undefined,
    };
  }

  if (typeof data === "object") {
    if (visited.has(data as object)) {
      return "[CIRCULAR]";
    }
    visited.add(data as object);

    if (Array.isArray(data)) {
      return data.map((item) => sanitizeLogData(item, visited));
    }

    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        sanitizedObj[key] = "[REDACTED]";
      } else {
        sanitizedObj[key] = sanitizeLogData(value, visited);
      }
    }
    return sanitizedObj;
  }

  return String(data);
}

/**
 * Generates a unique trace/correlation ID.
 */
export function generateTraceId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return randomUUID();
  } catch {
    return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }
}

/**
 * Extracts a correlation/trace ID from request headers or generates a new one.
 */
export function extractTraceId(source?: unknown): string {
  if (source && typeof source === "object") {
    const headers = (source as { headers?: unknown }).headers ?? source;
    if (headers && typeof (headers as { get?: unknown }).get === "function") {
      const getter = (headers as { get: (name: string) => string | null }).get.bind(headers);
      const id =
        getter("x-trace-id") ||
        getter("x-correlation-id") ||
        getter("x-request-id") ||
        getter("traceparent");
      if (id && typeof id === "string" && id.trim()) {
        return id.trim();
      }
    } else if (headers && typeof headers === "object") {
      const map = headers as Record<string, unknown>;
      const id =
        map["x-trace-id"] ||
        map["x-correlation-id"] ||
        map["x-request-id"] ||
        map["X-Trace-Id"] ||
        map["X-Correlation-Id"] ||
        map["X-Request-Id"] ||
        map["traceparent"];
      if (id && typeof id === "string" && id.trim()) {
        return id.trim();
      }
    }
  }
  return generateTraceId();
}

/**
 * Telemetry and logging service module for tracing transaction lifecycles
 * using structured JSON logs.
 */
export class TelemetryService {
  private static serviceName = "zendvo-backend";

  /**
   * Starts a high-resolution latency timer and returns a callback
   * yielding elapsed milliseconds.
   */
  static startTimer(): () => number {
    const start = Date.now();
    return () => Date.now() - start;
  }

  /**
   * Emits a structured JSON log entry to stdout or stderr.
   */
  static log(entry: Partial<TelemetryLog> & { event: string; level?: LogLevel }): TelemetryLog {
    const level: LogLevel = entry.level ?? "info";
    const payload: TelemetryLog = {
      timestamp: new Date().toISOString(),
      service: TelemetryService.serviceName,
      level,
      ...entry,
    };

    const sanitized = sanitizeLogData(payload) as TelemetryLog;
    const jsonOutput = JSON.stringify(sanitized);

    switch (level) {
      case "error":
        console.error(jsonOutput);
        break;
      case "warn":
        console.warn(jsonOutput);
        break;
      case "debug":
        console.debug ? console.debug(jsonOutput) : console.log(jsonOutput);
        break;
      case "info":
      default:
        console.log(jsonOutput);
        break;
    }

    return sanitized;
  }

  // --- XDR Generation Lifecycle ---

  static logXdrGenerationStart(params: XdrGenerationLogParams): TelemetryLog {
    return TelemetryService.log({
      level: "info",
      event: "savings.xdr_generation.started",
      stage: "xdr_generation",
      status: "started",
      traceId: params.traceId,
      userId: params.userId,
      transactionType: params.transactionType,
      amount: params.amount,
      currency: params.currency ?? "USDC",
      stellarAddress: params.stellarAddress,
      metadata: params.metadata,
    });
  }

  static logXdrGenerationSuccess(params: XdrGenerationLogParams): TelemetryLog {
    return TelemetryService.log({
      level: "info",
      event: "savings.xdr_generation.completed",
      stage: "xdr_generation",
      status: "completed",
      traceId: params.traceId,
      userId: params.userId,
      transactionType: params.transactionType,
      amount: params.amount,
      currency: params.currency ?? "USDC",
      stellarAddress: params.stellarAddress,
      txHash: params.txHash,
      durationMs: params.durationMs,
      metadata: params.metadata,
    });
  }

  static logXdrGenerationFailure(params: XdrGenerationLogParams): TelemetryLog {
    const errorMessage =
      params.errorMessage ||
      (params.error instanceof Error
        ? params.error.message
        : typeof params.error === "string"
        ? params.error
        : "Failed to generate XDR");

    return TelemetryService.log({
      level: "error",
      event: "savings.xdr_generation.failed",
      stage: "xdr_generation",
      status: "failed",
      traceId: params.traceId,
      userId: params.userId,
      transactionType: params.transactionType,
      amount: params.amount,
      currency: params.currency ?? "USDC",
      stellarAddress: params.stellarAddress,
      durationMs: params.durationMs,
      errorCode: params.errorCode ?? "XDR_GENERATION_ERROR",
      errorMessage,
      metadata: {
        ...params.metadata,
        error: sanitizeLogData(params.error),
      },
    });
  }

  // --- Network Submission Lifecycle ---

  static logSubmissionStart(params: SubmissionLogParams): TelemetryLog {
    return TelemetryService.log({
      level: "info",
      event: "savings.network_submission.started",
      stage: "network_submission",
      status: "started",
      traceId: params.traceId,
      userId: params.userId,
      transactionType: params.transactionType ?? "blockchain_submission",
      stellarAddress: params.stellarAddress,
      metadata: params.metadata,
    });
  }

  static logSubmissionSuccess(params: SubmissionLogParams): TelemetryLog {
    return TelemetryService.log({
      level: "info",
      event: "savings.network_submission.completed",
      stage: "network_submission",
      status: "completed",
      traceId: params.traceId,
      userId: params.userId,
      transactionType: params.transactionType ?? "blockchain_submission",
      stellarAddress: params.stellarAddress,
      txHash: params.txHash,
      durationMs: params.durationMs,
      attempts: params.attempts ?? 1,
      metadata: params.metadata,
    });
  }

  static logSubmissionFailure(params: SubmissionLogParams): TelemetryLog {
    const errorMessage =
      params.errorMessage ||
      (params.error instanceof Error
        ? params.error.message
        : typeof params.error === "string"
        ? params.error
        : "Network submission failed");

    return TelemetryService.log({
      level: "error",
      event: "savings.network_submission.failed",
      stage: "network_submission",
      status: "failed",
      traceId: params.traceId,
      userId: params.userId,
      transactionType: params.transactionType ?? "blockchain_submission",
      stellarAddress: params.stellarAddress,
      txHash: params.txHash,
      durationMs: params.durationMs,
      attempts: params.attempts,
      errorCode: params.errorCode ?? "SUBMISSION_ERROR",
      errorMessage,
      metadata: {
        ...params.metadata,
        error: sanitizeLogData(params.error),
      },
    });
  }

  // --- Confirmation Lifecycle ---

  static logConfirmationSuccess(params: ConfirmationLogParams): TelemetryLog {
    return TelemetryService.log({
      level: "info",
      event: "savings.transaction_confirmation.completed",
      stage: "transaction_confirmation",
      status: "completed",
      traceId: params.traceId,
      userId: params.userId,
      transactionType: params.transactionType,
      amount: params.amount,
      currency: params.currency ?? "USDC",
      txHash: params.txHash,
      durationMs: params.durationMs,
      metadata: {
        ...params.metadata,
        vaultContractId: params.vaultContractId,
      },
    });
  }

  static logConfirmationFailure(params: ConfirmationLogParams): TelemetryLog {
    const errorMessage =
      params.errorMessage ||
      (params.error instanceof Error
        ? params.error.message
        : typeof params.error === "string"
        ? params.error
        : "Transaction confirmation failed");

    return TelemetryService.log({
      level: "error",
      event: "savings.transaction_confirmation.failed",
      stage: "transaction_confirmation",
      status: "failed",
      traceId: params.traceId,
      userId: params.userId,
      transactionType: params.transactionType,
      amount: params.amount,
      currency: params.currency ?? "USDC",
      txHash: params.txHash,
      durationMs: params.durationMs,
      errorCode: params.errorCode ?? "CONFIRMATION_ERROR",
      errorMessage,
      metadata: {
        ...params.metadata,
        vaultContractId: params.vaultContractId,
        error: sanitizeLogData(params.error),
      },
    });
  }
}

export default TelemetryService;
