import { db } from "@/lib/db";
import {
  transactions,
  wallets,
  notifications,
  webhookRetryQueue,
} from "@/lib/db/schema";
import { eq, and, lte, asc, sql, inArray, or, isNull, lt } from "drizzle-orm";

/**
 * SEP-24 transaction status values as defined in the specification.
 * These map to internal transaction statuses in the database.
 */
export type Sep24TransactionStatus =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "pending_anchor"
  | "pending_trust"
  | "pending_stellar"
  | "pending_external"
  | "no_market"
  | "too_small"
  | "too_large"
  | "created"
  | "completed"
  | "refunded"
  | "expired"
  | "error";

/**
 * SEP-24 transaction types from the anchor callback.
 */
export type Sep24TransactionKind = "deposit" | "withdrawal";

/**
 * The shape of a SEP-24 transaction callback payload.
 * See: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
 */
export interface Sep24TransactionPayload {
  id: string;
  kind: Sep24TransactionKind;
  status: Sep24TransactionStatus;
  status_eta?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  /**
   * SEP-24 transaction objects do not require `asset_code` (it is an
   * optional extension). The wallet currency is resolved from the matched
   * internal transaction instead; a supplied value is validated against it.
   */
  asset_code?: string;
  account?: string;
  memo?: string;
  memo_type?: string;
  stellar_account_id?: string;
  claimable_balance_id?: string;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * The shape of a SEP-24 anchor callback body: the transaction is wrapped
 * in a `transaction` envelope object. Bare transactions (no envelope) are
 * also accepted for forwards compatibility.
 * See: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
 */
export interface Sep24TransactionEnvelope {
  transaction: Sep24TransactionPayload;
  [key: string]: unknown;
}

/**
 * Extracts the transaction from a parsed SEP-24 callback body, unwrapping
 * the `{"transaction": {...}}` envelope when present. Returns the body
 * unchanged when it already is a bare transaction.
 */
export function extractSep24Transaction(
  body: unknown,
): Sep24TransactionPayload {
  if (body && typeof body === "object" && "transaction" in body) {
    const transaction = (body as Sep24TransactionEnvelope).transaction;
    if (transaction && typeof transaction === "object") {
      return transaction;
    }
  }
  return body as Sep24TransactionPayload;
}

/**
 * Maps SEP-24 anchor statuses to internal transaction statuses.
 */
function mapSep24StatusToInternal(
  status: Sep24TransactionStatus,
): "pending" | "submitted" | "completed" | "failed" {
  switch (status) {
    case "completed":
      return "completed";
    case "refunded":
    case "expired":
    case "error":
    case "no_market":
    case "too_small":
    case "too_large":
      return "failed";
    default:
      return "submitted";
  }
}

/**
 * Internal transaction lifecycle order. `completed` and `failed` are both
 * terminal (rank 2): a transaction must never move backwards along this
 * order, so a stale retry or a redelivered older callback cannot regress
 * a newer state.
 */
type InternalTransactionStatus = "pending" | "submitted" | "completed" | "failed";

const INTERNAL_STATUS_RANK: Record<InternalTransactionStatus, number> = {
  pending: 0,
  submitted: 1,
  completed: 2,
  failed: 2,
};

/**
 * Statuses a transaction may currently hold for a transition to `next` to
 * be applied. A refund is the one legitimate move out of `completed`
 * (it lands on `failed`); every other backwards move is stale and must be
 * dropped, not retried.
 */
function allowedPredecessorsFor(
  current: InternalTransactionStatus,
  next: InternalTransactionStatus,
  sep24Status: Sep24TransactionStatus,
): InternalTransactionStatus[] | null {
  if (next === current) {
    // Idempotent re-delivery: already applied, nothing to do.
    return [];
  }
  const isRefundAfterCompletion =
    current === "completed" && sep24Status === "refunded";
  const isForward =
    INTERNAL_STATUS_RANK[next] > INTERNAL_STATUS_RANK[current];
  if (!isForward && !isRefundAfterCompletion) {
    return null;
  }
  if (next === "failed") {
    return isRefundAfterCompletion
      ? ["pending", "submitted", "completed"]
      : ["pending", "submitted"];
  }
  if (next === "completed") {
    return ["pending", "submitted"];
  }
  // next === "submitted"
  return ["pending"];
}

/** The client passed to a `db.transaction` callback. */
type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Creates a user-friendly notification message based on the SEP-24 event.
 */
function buildNotification(
  kind: Sep24TransactionKind,
  status: Sep24TransactionStatus,
  assetCode: string,
  amount?: string,
): { title: string; message: string } {
  const amountStr = amount ? ` of ${amount} ${assetCode}` : "";
  const kindLabel = kind === "deposit" ? "Deposit" : "Withdrawal";

  switch (status) {
    case "completed":
      return {
        title: `${kindLabel} completed`,
        message: `Your ${kind.toLowerCase()}${amountStr} has been completed successfully.`,
      };
    case "pending_user_transfer_start":
      return {
        title: `${kindLabel} awaiting transfer`,
        message: `Your ${kind.toLowerCase()}${amountStr} is ready. Please complete the transfer.`,
      };
    case "pending_user_transfer_complete":
      return {
        title: `${kindLabel} ready for pickup`,
        message: `Your ${kind.toLowerCase()}${amountStr} is ready for pickup.`,
      };
    case "refunded":
      return {
        title: `${kindLabel} refunded`,
        message: `Your ${kind.toLowerCase()}${amountStr} has been refunded.`,
      };
    case "expired":
      return {
        title: `${kindLabel} expired`,
        message: `Your ${kind.toLowerCase()}${amountStr} has expired.`,
      };
    case "error":
      return {
        title: `${kindLabel} failed`,
        message: `Your ${kind.toLowerCase()}${amountStr} encountered an error. Please try again.`,
      };
    default:
      return {
        title: `${kindLabel} status update`,
        message: `Your ${kind.toLowerCase()}${amountStr} status has been updated to: ${status}.`,
      };
  }
}

/**
 * Finds the internal transaction by matching the SEP-24 transaction ID
 * stored in the reference field.
 */
async function findTransactionByAnchorId(anchorTxId: string) {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.reference, anchorTxId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Processes a SEP-24 webhook callback and updates internal state.
 *
 * Steps:
 * 1. Find the matching internal transaction by anchor transaction ID
 * 2. Resolve the wallet currency from the matched transaction (a supplied
 *    `asset_code` is validated against it, never trusted blindly)
 * 3. Reject stale callbacks that would move the transaction backwards
 *    (a repeated delivery of the current status is an idempotent no-op)
 * 4. Inside one database transaction: claim the transition with a
 *    conditional status update (only one concurrent worker can win it),
 *    apply the wallet balance change, and insert the notification — so a
 *    completed transaction's effects are committed exactly once
 */
export async function processSep24Webhook(
  payload: Sep24TransactionPayload,
): Promise<{ processed: boolean; error?: string }> {
  const { id: anchorTxId, kind, status, amount_in, amount_out, asset_code } =
    payload;

  if (!anchorTxId) {
    return { processed: false, error: "Missing transaction id in payload" };
  }

  if (!kind || (kind !== "deposit" && kind !== "withdrawal")) {
    return {
      processed: false,
      error: `Invalid transaction kind: ${kind}`,
    };
  }

  if (!status) {
    return { processed: false, error: "Missing transaction status in payload" };
  }

  // Find the internal transaction
  const internalTx = await findTransactionByAnchorId(anchorTxId);

  if (!internalTx) {
    // Transaction not found — may be from an anchor we don't track.
    // Still return success to acknowledge receipt (avoid anchor retries).
    console.warn(
      `[SEP24_WEBHOOK] Unknown anchor transaction: ${anchorTxId}`,
    );
    return { processed: true };
  }

  // Resolve the wallet currency from the matched transaction. SEP-24 does
  // not require asset_code on the callback, so a missing value is fine;
  // a supplied value that disagrees with the transaction is a data error.
  const currency = internalTx.currency;
  if (!currency) {
    return {
      processed: false,
      error: `Internal transaction ${internalTx.id} has no currency`,
    };
  }
  if (asset_code && asset_code !== currency) {
    return {
      processed: false,
      error:
        `Asset mismatch for transaction ${anchorTxId}: callback asset_code ` +
        `"${asset_code}" does not match transaction currency "${currency}"`,
    };
  }

  const newStatus = mapSep24StatusToInternal(status);
  const currentStatus = internalTx.status as InternalTransactionStatus;

  // Forward-only transition check (read-side fast path; the conditional
  // update inside the transaction is the authoritative claim).
  const predecessors = allowedPredecessorsFor(currentStatus, newStatus, status);
  if (predecessors === null) {
    console.warn(
      `[SEP24_WEBHOOK] Ignoring stale ${status} callback for ${anchorTxId}: ` +
        `transaction is already ${currentStatus}`,
    );
    return { processed: true };
  }
  if (predecessors.length === 0) {
    // Idempotent re-delivery of the current status: already applied.
    return { processed: true };
  }

  // The amount actually delivered to the user. SEP-24 defines amount_out
  // as the settled amount; amount_in is only a fallback when the anchor
  // did not report one. Withdrawals keep using amount_in (unchanged).
  const settledAmount =
    kind === "deposit" ? (amount_out ?? amount_in) : amount_in;

  return db.transaction(async (tx) => {
    // Concurrency-safe completion claim: only proceed if the transaction
    // still holds a status this transition may move from. A concurrent
    // worker that already applied this (or a newer) transition makes this
    // update match zero rows, and we skip the balance change and
    // notification entirely — the effects are committed exactly once.
    const claimed = await tx
      .update(transactions)
      .set({ status: newStatus })
      .where(
        and(
          eq(transactions.id, internalTx.id),
          inArray(transactions.status, predecessors),
        ),
      )
      .returning({ id: transactions.id });

    if (claimed.length === 0) {
      return { processed: true };
    }

    // For completed deposits, credit the user's wallet with the settled
    // (delivered) amount. The status is only marked completed as part of
    // this same transaction, after the balance change is queued here — a
    // failure anywhere rolls the whole thing back for a clean retry.
    if (status === "completed" && kind === "deposit" && settledAmount) {
      const amount = parseFloat(settledAmount);
      if (!isNaN(amount) && amount > 0) {
        await creditWallet(tx, internalTx.userId, currency, amount);
      }
    }

    // For completed withdrawals, debit the user's wallet
    if (status === "completed" && kind === "withdrawal" && settledAmount) {
      const amount = parseFloat(settledAmount);
      if (!isNaN(amount) && amount > 0) {
        await debitWallet(tx, internalTx.userId, currency, amount);
      }
    }

    // Create a notification for the user
    const { title, message } = buildNotification(
      kind,
      status,
      currency,
      settledAmount,
    );
    await tx.insert(notifications).values({
      userId: internalTx.userId,
      type: `sep24_${kind}_${status}`,
      title,
      message,
    });

    return { processed: true };
  });
}

/**
 * Credits a user's wallet with the specified amount of an asset.
 *
 * The balance is computed database-side (`balance + amount`) inside a
 * single upsert, so concurrent callbacks for different transactions on
 * the same wallet cannot lose each other's update, and two concurrent
 * first credits cannot create two wallet rows: the
 * `wallet_user_currency_key` unique constraint on (user_id, currency)
 * collapses them into one row.
 */
async function creditWallet(
  tx: TransactionClient,
  userId: string,
  currency: string,
  amount: number,
): Promise<void> {
  await tx
    .insert(wallets)
    .values({
      userId,
      currency,
      balance: amount,
    })
    .onConflictDoUpdate({
      target: [wallets.userId, wallets.currency],
      set: {
        balance: sql`${wallets.balance} + ${amount}`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Debits a user's wallet for the specified amount of an asset.
 *
 * The balance is computed database-side (`balance - amount`) in a single
 * update, so concurrent callbacks cannot lose each other's update.
 */
async function debitWallet(
  tx: TransactionClient,
  userId: string,
  currency: string,
  amount: number,
): Promise<void> {
  await tx
    .update(wallets)
    .set({
      balance: sql`${wallets.balance} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(and(eq(wallets.userId, userId), eq(wallets.currency, currency)));
  // If the wallet doesn't exist, the update matches zero rows and the
  // debit is a no-op (insufficient funds scenario should be handled
  // upstream)
}

// ── Webhook retry queue ──────────────────────────────────────────────────────

/** Delay before the first retry attempt. */
export const WEBHOOK_RETRY_BASE_DELAY_MS = 60_000;
/** Upper bound for the exponential backoff delay (1 hour). */
export const WEBHOOK_RETRY_MAX_DELAY_MS = 3_600_000;
/**
 * How long a `claimDue` lease is held before a crashed worker's event
 * becomes claimable again (10 minutes).
 */
export const WEBHOOK_RETRY_CLAIM_TTL_MS = 600_000;
/** Default number of queued events processed per sweep. */
export const WEBHOOK_RETRY_BATCH_SIZE = 10;
/** Default maximum attempts before a queued event is dropped. */
export const WEBHOOK_RETRY_DEFAULT_MAX_RETRIES = 5;

/**
 * Exponential backoff for webhook retries: 1m, 2m, 4m, 8m, 16m, 32m,
 * capped at 1h. `retryCount` is the attempt number that just failed
 * (1 = first failure).
 */
export function computeBackoffDelayMs(retryCount: number): number {
  const delay = WEBHOOK_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1);
  return Math.min(delay, WEBHOOK_RETRY_MAX_DELAY_MS);
}

export interface WebhookRetryEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence for the webhook retry queue. The default implementation
 * talks to Postgres through Drizzle; tests inject an in-memory fake.
 */
export interface WebhookRetryStore {
  enqueue(input: {
    eventType: string;
    payload: Record<string, unknown>;
    retryCount: number;
    maxRetries: number;
    nextAttemptAt: Date;
    lastError: string;
  }): Promise<WebhookRetryEvent>;
  /**
   * Atomically claims up to `limit` due events for this worker and
   * returns them. Claimed events are invisible to other workers until
   * the claim is released (`recordFailure`) or expires
   * (`WEBHOOK_RETRY_CLAIM_TTL_MS`); a successful event is `remove`d.
   * A process-local overlap guard is not a substitute for this claim.
   */
  claimDue(now: Date, limit: number): Promise<WebhookRetryEvent[]>;
  remove(id: string): Promise<void>;
  recordFailure(
    id: string,
    update: { retryCount: number; nextAttemptAt: Date; lastError: string },
  ): Promise<void>;
}

function toWebhookRetryEvent(
  row: typeof webhookRetryQueue.$inferSelect,
): WebhookRetryEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    payload: row.payload as Record<string, unknown>,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const drizzleWebhookRetryStore: WebhookRetryStore = {
  async enqueue(input) {
    const [row] = await db
      .insert(webhookRetryQueue)
      .values(input)
      .returning();
    return toWebhookRetryEvent(row);
  },

  /**
   * Atomic cross-process claim: a single UPDATE stamps `claimedAt` on
   * the due rows it returns, so two backend processes sweeping at the
   * same time can never receive the same event. Rows whose claim is
   * older than the TTL are treated as abandoned (crashed worker) and
   * become claimable again.
   */
  async claimDue(now, limit) {
    const staleBefore = new Date(now.getTime() - WEBHOOK_RETRY_CLAIM_TTL_MS);
    const claimable = db
      .select({ id: webhookRetryQueue.id })
      .from(webhookRetryQueue)
      .where(
        and(
          lte(webhookRetryQueue.nextAttemptAt, now),
          or(
            isNull(webhookRetryQueue.claimedAt),
            lt(webhookRetryQueue.claimedAt, staleBefore),
          ),
        ),
      )
      .orderBy(asc(webhookRetryQueue.nextAttemptAt))
      .limit(limit);
    const rows = await db
      .update(webhookRetryQueue)
      .set({ claimedAt: now, updatedAt: now })
      .where(inArray(webhookRetryQueue.id, claimable))
      .returning();
    return rows.map(toWebhookRetryEvent);
  },

  async remove(id) {
    await db.delete(webhookRetryQueue).where(eq(webhookRetryQueue.id, id));
  },

  async recordFailure(id, update) {
    await db
      .update(webhookRetryQueue)
      // Release the claim so the event can be claimed again once its
      // next attempt is due.
      .set({ ...update, claimedAt: null, updatedAt: new Date() })
      .where(eq(webhookRetryQueue.id, id));
  },
};

/**
 * Enqueues a failed webhook event for retry.
 *
 * The first re-attempt is scheduled `WEBHOOK_RETRY_BASE_DELAY_MS` (1 minute)
 * after the failure; later attempts use exponential backoff.
 */
export async function enqueueWebhookRetry(
  eventType: string,
  payload: Record<string, unknown>,
  lastError: string,
  store: WebhookRetryStore = drizzleWebhookRetryStore,
): Promise<WebhookRetryEvent> {
  return store.enqueue({
    eventType,
    payload,
    retryCount: 0,
    maxRetries: WEBHOOK_RETRY_DEFAULT_MAX_RETRIES,
    nextAttemptAt: new Date(Date.now() + WEBHOOK_RETRY_BASE_DELAY_MS),
    lastError,
  });
}

/**
 * Re-processes one queued webhook event. Throws on failure so the caller
 * can apply the backoff schedule; unknown event types are unrecoverable
 * and also throw (they are dropped after max retries).
 */
export async function handleQueuedWebhookEvent(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (eventType === "sep24_transaction") {
    const result = await processSep24Webhook(
      payload as unknown as Sep24TransactionPayload,
    );
    if (!result.processed) {
      throw new Error(result.error || "Failed to process webhook event");
    }
    return;
  }

  throw new Error(`Unknown webhook event type: ${eventType}`);
}

export interface WebhookRetrySummary {
  /** Due events found in this sweep. */
  checked: number;
  /** Events re-processed successfully and removed from the queue. */
  succeeded: number;
  /** Events that failed again and were rescheduled with backoff. */
  failed: number;
  /** Events dropped after exhausting max retries. */
  deadLettered: number;
}

export interface WebhookRetryProcessorDeps {
  store?: WebhookRetryStore;
  handleEvent?: (
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  now?: () => Date;
  batchSize?: number;
}

/**
 * One sweep of the webhook retry queue: re-attempts every event whose
 * `nextAttemptAt` has passed.
 *
 * - Success removes the event from the queue.
 * - Failure reschedules it with exponential backoff and records the error.
 * - An event that reaches `maxRetries` is dropped (dead-lettered) and the
 *   failure is logged so it is not lost silently.
 */
export async function processWebhookRetryQueue(
  deps: WebhookRetryProcessorDeps = {},
): Promise<WebhookRetrySummary> {
  const store = deps.store ?? drizzleWebhookRetryStore;
  const handleEvent = deps.handleEvent ?? handleQueuedWebhookEvent;
  const now = deps.now ?? (() => new Date());
  const batchSize = deps.batchSize ?? WEBHOOK_RETRY_BATCH_SIZE;

  const startedAt = now();
  const due = await store.claimDue(startedAt, batchSize);

  let succeeded = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const event of due) {
    try {
      await handleEvent(event.eventType, event.payload);
      await store.remove(event.id);
      succeeded++;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      const nextRetryCount = event.retryCount + 1;

      if (nextRetryCount >= event.maxRetries) {
        await store.remove(event.id);
        deadLettered++;
        console.error(
          `[WEBHOOK_RETRY] Dropping event ${event.id} (${event.eventType}) after ${nextRetryCount} attempts: ${message}`,
        );
      } else {
        // The backoff starts when this attempt failed, not when the
        // sweep started — a slow attempt must not be retried immediately.
        const failedAt = now();
        await store.recordFailure(event.id, {
          retryCount: nextRetryCount,
          nextAttemptAt: new Date(
            failedAt.getTime() + computeBackoffDelayMs(nextRetryCount),
          ),
          lastError: message,
        });
        failed++;
      }
    }
  }

  return { checked: due.length, succeeded, failed, deadLettered };
}
