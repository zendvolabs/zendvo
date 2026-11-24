import {
  computeBackoffDelayMs,
  enqueueWebhookRetry,
  extractSep24Transaction,
  handleQueuedWebhookEvent,
  processSep24Webhook,
  processWebhookRetryQueue,
  WEBHOOK_RETRY_BASE_DELAY_MS,
  WEBHOOK_RETRY_CLAIM_TTL_MS,
  WEBHOOK_RETRY_MAX_DELAY_MS,
  type WebhookRetryEvent,
  type WebhookRetryStore,
} from "@/server/services/webhookService";
import { db } from "@/lib/db";
import { wallets, notifications } from "@/lib/db/schema";
import { SQL } from "drizzle-orm";

// The webhook service talks to Postgres through the module-level `db`.
// Tests replace it with chain mocks (same pattern as otpService.test.ts);
// `transaction` runs its callback against the same mock object.
jest.mock("@/lib/db", () => {
  const db: {
    select: jest.Mock;
    update: jest.Mock;
    insert: jest.Mock;
    delete: jest.Mock;
    transaction: jest.Mock;
  } = {
    select: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
    transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { db };
});

const mockDb = db as unknown as {
  select: jest.Mock;
  update: jest.Mock;
  insert: jest.Mock;
  transaction: jest.Mock;
};

/** In-memory fake of the WebhookRetryQueue table for processor tests. */
class InMemoryWebhookRetryStore implements WebhookRetryStore {
  events: WebhookRetryEvent[] = [];
  private seq = 0;
  /** event id -> claim timestamp (mirrors the `claimed_at` lease column) */
  private claims = new Map<string, Date>();

  async enqueue(input: {
    eventType: string;
    payload: Record<string, unknown>;
    retryCount: number;
    maxRetries: number;
    nextAttemptAt: Date;
    lastError: string;
  }): Promise<WebhookRetryEvent> {
    const event: WebhookRetryEvent = {
      id: `evt-${++this.seq}`,
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.events.push(event);
    return event;
  }

  /**
   * Atomically claims due events: an event is handed out only if it is
   * due and unclaimed (or its claim is older than the TTL, i.e. its
   * worker crashed). Claimed events stay claimed until `remove` or
   * `recordFailure` releases them.
   */
  async claimDue(now: Date, limit: number): Promise<WebhookRetryEvent[]> {
    const staleBefore = now.getTime() - WEBHOOK_RETRY_CLAIM_TTL_MS;
    const due = this.events
      .filter((e) => {
        if (e.nextAttemptAt > now) return false;
        const claimedAt = this.claims.get(e.id);
        return !claimedAt || claimedAt.getTime() < staleBefore;
      })
      .sort(
        (a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime(),
      )
      .slice(0, limit);
    for (const event of due) {
      this.claims.set(event.id, now);
    }
    return due;
  }

  async remove(id: string): Promise<void> {
    this.events = this.events.filter((e) => e.id !== id);
    this.claims.delete(id);
  }

  async recordFailure(
    id: string,
    update: { retryCount: number; nextAttemptAt: Date; lastError: string },
  ): Promise<void> {
    const event = this.events.find((e) => e.id === id);
    if (event) {
      Object.assign(event, update, { updatedAt: new Date() });
      // Release the claim so the event can be claimed again once due.
      this.claims.delete(id);
    }
  }
}

const NOW = new Date("2026-11-23T12:00:00.000Z");

describe("computeBackoffDelayMs", () => {
  it("starts at 1 minute and doubles per attempt", () => {
    expect(computeBackoffDelayMs(1)).toBe(60_000);
    expect(computeBackoffDelayMs(2)).toBe(120_000);
    expect(computeBackoffDelayMs(3)).toBe(240_000);
    expect(computeBackoffDelayMs(4)).toBe(480_000);
    expect(computeBackoffDelayMs(5)).toBe(960_000);
  });

  it("caps at 1 hour", () => {
    expect(computeBackoffDelayMs(7)).toBe(WEBHOOK_RETRY_MAX_DELAY_MS);
    expect(computeBackoffDelayMs(100)).toBe(WEBHOOK_RETRY_MAX_DELAY_MS);
    expect(WEBHOOK_RETRY_BASE_DELAY_MS).toBe(60_000);
    expect(WEBHOOK_RETRY_MAX_DELAY_MS).toBe(3_600_000);
  });
});

describe("enqueueWebhookRetry", () => {
  it("persists the failed event with a 1 minute backoff schedule", async () => {
    const store = new InMemoryWebhookRetryStore();
    const before = Date.now();

    const event = await enqueueWebhookRetry(
      "sep24_transaction",
      { id: "anchor-tx-1" },
      "Processing failed",
      store,
    );

    expect(event.eventType).toBe("sep24_transaction");
    expect(event.payload).toEqual({ id: "anchor-tx-1" });
    expect(event.retryCount).toBe(0);
    expect(event.maxRetries).toBe(5);
    expect(event.lastError).toBe("Processing failed");
    expect(event.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + WEBHOOK_RETRY_BASE_DELAY_MS,
    );
    expect(event.nextAttemptAt.getTime()).toBeLessThanOrEqual(
      Date.now() + WEBHOOK_RETRY_BASE_DELAY_MS,
    );
    expect(store.events).toHaveLength(1);
  });
});

describe("processWebhookRetryQueue", () => {
  it("re-attempts a due event and removes it on success", async () => {
    const store = new InMemoryWebhookRetryStore();
    await store.enqueue({
      eventType: "sep24_transaction",
      payload: { id: "anchor-tx-1" },
      retryCount: 0,
      maxRetries: 5,
      nextAttemptAt: new Date(NOW.getTime() - 1000),
      lastError: "first failure",
    });
    const handleEvent = jest.fn().mockResolvedValue(undefined);

    const summary = await processWebhookRetryQueue({
      store,
      handleEvent,
      now: () => NOW,
    });

    expect(summary).toEqual({
      checked: 1,
      succeeded: 1,
      failed: 0,
      deadLettered: 0,
    });
    expect(handleEvent).toHaveBeenCalledWith("sep24_transaction", {
      id: "anchor-tx-1",
    });
    expect(store.events).toHaveLength(0);
  });

  it("skips events whose next attempt is still in the future", async () => {
    const store = new InMemoryWebhookRetryStore();
    await store.enqueue({
      eventType: "sep24_transaction",
      payload: { id: "anchor-tx-1" },
      retryCount: 0,
      maxRetries: 5,
      nextAttemptAt: new Date(NOW.getTime() + 60_000),
      lastError: "first failure",
    });
    const handleEvent = jest.fn().mockResolvedValue(undefined);

    const summary = await processWebhookRetryQueue({
      store,
      handleEvent,
      now: () => NOW,
    });

    expect(summary.checked).toBe(0);
    expect(handleEvent).not.toHaveBeenCalled();
    expect(store.events).toHaveLength(1);
  });

  it("reschedules a failed event with exponential backoff", async () => {
    const store = new InMemoryWebhookRetryStore();
    await store.enqueue({
      eventType: "sep24_transaction",
      payload: { id: "anchor-tx-1" },
      retryCount: 0,
      maxRetries: 5,
      nextAttemptAt: new Date(NOW.getTime() - 1000),
      lastError: "first failure",
    });
    const handleEvent = jest
      .fn()
      .mockRejectedValue(new Error("anchor unreachable"));

    const summary = await processWebhookRetryQueue({
      store,
      handleEvent,
      now: () => NOW,
    });

    expect(summary).toEqual({
      checked: 1,
      succeeded: 0,
      failed: 1,
      deadLettered: 0,
    });
    const [event] = store.events;
    expect(event.retryCount).toBe(1);
    expect(event.lastError).toBe("anchor unreachable");
    expect(event.nextAttemptAt.getTime()).toBe(
      NOW.getTime() + computeBackoffDelayMs(1),
    );
  });

  it("escalates the backoff on repeated failures", async () => {
    const store = new InMemoryWebhookRetryStore();
    await store.enqueue({
      eventType: "sep24_transaction",
      payload: { id: "anchor-tx-1" },
      retryCount: 2,
      maxRetries: 5,
      nextAttemptAt: new Date(NOW.getTime() - 1000),
      lastError: "second failure",
    });
    const handleEvent = jest
      .fn()
      .mockRejectedValue(new Error("still failing"));

    await processWebhookRetryQueue({
      store,
      handleEvent,
      now: () => NOW,
    });

    const [event] = store.events;
    expect(event.retryCount).toBe(3);
    expect(event.nextAttemptAt.getTime()).toBe(
      NOW.getTime() + computeBackoffDelayMs(3),
    );
  });

  it("drops the event after max retries are exhausted", async () => {
    const store = new InMemoryWebhookRetryStore();
    await store.enqueue({
      eventType: "sep24_transaction",
      payload: { id: "anchor-tx-1" },
      retryCount: 4,
      maxRetries: 5,
      nextAttemptAt: new Date(NOW.getTime() - 1000),
      lastError: "fourth failure",
    });
    const handleEvent = jest
      .fn()
      .mockRejectedValue(new Error("permanent failure"));

    const summary = await processWebhookRetryQueue({
      store,
      handleEvent,
      now: () => NOW,
    });

    expect(summary).toEqual({
      checked: 1,
      succeeded: 0,
      failed: 0,
      deadLettered: 1,
    });
    expect(store.events).toHaveLength(0);
  });

  it("respects the batch size", async () => {
    const store = new InMemoryWebhookRetryStore();
    for (let i = 0; i < 3; i++) {
      await store.enqueue({
        eventType: "sep24_transaction",
        payload: { id: `anchor-tx-${i}` },
        retryCount: 0,
        maxRetries: 5,
        nextAttemptAt: new Date(NOW.getTime() - 1000),
        lastError: "failure",
      });
    }
    const handleEvent = jest.fn().mockResolvedValue(undefined);

    const summary = await processWebhookRetryQueue({
      store,
      handleEvent,
      now: () => NOW,
      batchSize: 2,
    });

    expect(summary.checked).toBe(2);
    expect(store.events).toHaveLength(1);
  });

  it("processes due events oldest-first", async () => {
    const store = new InMemoryWebhookRetryStore();
    const seen: string[] = [];
    await store.enqueue({
      eventType: "sep24_transaction",
      payload: { id: "newer" },
      retryCount: 0,
      maxRetries: 5,
      nextAttemptAt: new Date(NOW.getTime() - 1000),
      lastError: "failure",
    });
    await store.enqueue({
      eventType: "sep24_transaction",
      payload: { id: "older" },
      retryCount: 0,
      maxRetries: 5,
      nextAttemptAt: new Date(NOW.getTime() - 60_000),
      lastError: "failure",
    });

    await processWebhookRetryQueue({
      store,
      handleEvent: jest.fn(async (_type, payload) => {
        seen.push(payload.id as string);
      }),
      now: () => NOW,
    });

    expect(seen).toEqual(["older", "newer"]);
  });
});

describe("handleQueuedWebhookEvent", () => {
  it("throws for unknown event types", async () => {
    await expect(
      handleQueuedWebhookEvent("unknown_event", { foo: "bar" }),
    ).rejects.toThrow("Unknown webhook event type: unknown_event");
  });
});

describe("processSep24Webhook validation", () => {
  // These cases fail before any database access, so no DB is needed.
  it("rejects a payload with no transaction id", async () => {
    const result = await processSep24Webhook({
      kind: "deposit",
      status: "completed",
      asset_code: "USDC",
    } as never);

    expect(result).toEqual({
      processed: false,
      error: "Missing transaction id in payload",
    });
  });

  it("rejects an invalid transaction kind", async () => {
    const result = await processSep24Webhook({
      id: "anchor-tx-1",
      kind: "transfer",
      status: "completed",
      asset_code: "USDC",
    } as never);

    expect(result.processed).toBe(false);
    expect(result.error).toContain("Invalid transaction kind");
  });

  it("rejects a payload with no status", async () => {
    const result = await processSep24Webhook({
      id: "anchor-tx-1",
      kind: "deposit",
      asset_code: "USDC",
    } as never);

    expect(result).toEqual({
      processed: false,
      error: "Missing transaction status in payload",
    });
  });
});

describe("extractSep24Transaction", () => {
  it("unwraps the { transaction } envelope", () => {
    const tx = { id: "anchor-tx-1", kind: "deposit", status: "completed" };
    expect(extractSep24Transaction({ transaction: tx })).toEqual(tx);
  });

  it("passes a bare transaction through unchanged", () => {
    const tx = { id: "anchor-tx-1", kind: "deposit", status: "completed" };
    expect(extractSep24Transaction(tx)).toEqual(tx);
  });

  it("passes the body through when transaction is not an object", () => {
    const body = { transaction: null, id: "anchor-tx-1" };
    expect(extractSep24Transaction(body)).toEqual(body);
  });
});

describe("processSep24Webhook — wallet effects and transitions", () => {
  const INTERNAL_TX = {
    id: "internal-tx-1",
    userId: "user-1",
    walletId: null,
    type: "deposit",
    status: "submitted",
    amount: 100,
    currency: "USDC",
    reference: "anchor-tx-1",
    provider: null,
    blockchainTxHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const COMPLETED_DEPOSIT = {
    id: "anchor-tx-1",
    kind: "deposit" as const,
    status: "completed" as const,
    amount_in: "100.00",
    amount_out: "99.50",
    amount_fee: "0.50",
    asset_code: "USDC",
  };

  /**
   * Configures the db chain mocks for one processSep24Webhook call:
   * - `db.select` resolves the matched internal transaction (or none)
   * - the conditional status update inside the transaction claims the
   *   transition unless `claimWon` is false
   * - `db.insert` resolves for wallet upserts and notifications
   */
  function setupDbMocks(options: {
    transactionRow?: Record<string, unknown> | null;
    claimWon?: boolean;
  } = {}) {
    const onConflictDoUpdateMock = jest.fn().mockResolvedValue(undefined);
    const valuesMock = jest.fn().mockReturnValue({
      onConflictDoUpdate: onConflictDoUpdateMock,
    });
    mockDb.insert.mockReturnValue({ values: valuesMock });

    const returningMock = jest
      .fn()
      .mockResolvedValue(
        options.claimWon === false ? [] : [{ id: "internal-tx-1" }],
      );
    const whereResult = Promise.resolve(undefined) as Promise<undefined> & {
      returning: jest.Mock;
    };
    whereResult.returning = returningMock;
    const whereMock = jest.fn().mockReturnValue(whereResult);
    const setMock = jest.fn().mockReturnValue({ where: whereMock });
    mockDb.update.mockReturnValue({ set: setMock });

    const row =
      options.transactionRow === undefined
        ? INTERNAL_TX
        : options.transactionRow;
    mockDb.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(row ? [row] : []),
        }),
      }),
    });

    return { valuesMock, onConflictDoUpdateMock, setMock, returningMock };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("credits a completed deposit with amount_out, not amount_in", async () => {
    const { valuesMock, onConflictDoUpdateMock } = setupDbMocks();

    const result = await processSep24Webhook(COMPLETED_DEPOSIT);

    expect(result).toEqual({ processed: true });
    expect(mockDb.insert).toHaveBeenCalledWith(wallets);
    // 100 in / 99.50 out: the wallet is credited the delivered 99.50.
    expect(valuesMock.mock.calls[0][0]).toEqual({
      userId: "user-1",
      currency: "USDC",
      balance: 99.5,
    });
    // Upsert on (user_id, currency) with a database-side balance update.
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
    const upsert = onConflictDoUpdateMock.mock.calls[0][0];
    expect(upsert.target).toHaveLength(2);
    expect(upsert.set.balance).toBeInstanceOf(SQL);
    // Notification still uses the settled amount.
    expect(valuesMock.mock.calls[1][0].message).toContain("99.50 USDC");
  });

  it("falls back to amount_in when amount_out is absent", async () => {
    const { amount_out: _out, ...noOut } = COMPLETED_DEPOSIT;
    const { valuesMock } = setupDbMocks();

    const result = await processSep24Webhook(noOut);

    expect(result).toEqual({ processed: true });
    expect(valuesMock.mock.calls[0][0].balance).toBe(100);
  });

  it("does not re-credit when the transaction is already completed", async () => {
    setupDbMocks({
      transactionRow: { ...INTERNAL_TX, status: "completed" },
    });

    const result = await processSep24Webhook(COMPLETED_DEPOSIT);

    expect(result).toEqual({ processed: true });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("ignores a stale callback that would regress completed to submitted", async () => {
    setupDbMocks({
      transactionRow: { ...INTERNAL_TX, status: "completed" },
    });

    const result = await processSep24Webhook({
      ...COMPLETED_DEPOSIT,
      status: "pending_anchor",
    });

    expect(result).toEqual({ processed: true });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("applies a refund after completion without crediting again", async () => {
    const { setMock } = setupDbMocks({
      transactionRow: { ...INTERNAL_TX, status: "completed" },
    });

    const result = await processSep24Webhook({
      ...COMPLETED_DEPOSIT,
      status: "refunded",
    });

    expect(result).toEqual({ processed: true });
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(setMock.mock.calls[0][0]).toEqual({ status: "failed" });
    expect(mockDb.insert).toHaveBeenCalledWith(notifications);
    expect(mockDb.insert).not.toHaveBeenCalledWith(wallets);
  });

  it("resolves the wallet currency from the matched transaction when asset_code is missing", async () => {
    const { asset_code: _code, ...noAsset } = COMPLETED_DEPOSIT;
    const { valuesMock } = setupDbMocks();

    const result = await processSep24Webhook(noAsset);

    expect(result).toEqual({ processed: true });
    expect(valuesMock.mock.calls[0][0]).toEqual({
      userId: "user-1",
      currency: "USDC",
      balance: 99.5,
    });
  });

  it("rejects a callback whose asset_code disagrees with the transaction", async () => {
    setupDbMocks();

    const result = await processSep24Webhook({
      ...COMPLETED_DEPOSIT,
      asset_code: "EUR",
    });

    expect(result.processed).toBe(false);
    expect(result.error).toContain("Asset mismatch");
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("skips the wallet credit and notification when another worker claims the transition first", async () => {
    setupDbMocks({ claimWon: false });

    const result = await processSep24Webhook(COMPLETED_DEPOSIT);

    expect(result).toEqual({ processed: true });
    // The claim attempt ran, but nothing was written.
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("debits a completed withdrawal with database-side arithmetic", async () => {
    const { setMock } = setupDbMocks();

    const result = await processSep24Webhook({
      id: "anchor-tx-1",
      kind: "withdrawal",
      status: "completed",
      amount_in: "25.00",
      asset_code: "USDC",
    });

    expect(result).toEqual({ processed: true });
    const walletSet = setMock.mock.calls
      .map((call) => call[0])
      .find((set) => "balance" in set);
    expect(walletSet).toBeDefined();
    // The new balance is a SQL expression (balance - amount), not a
    // value computed in JavaScript from an earlier read.
    expect(walletSet.balance).toBeInstanceOf(SQL);
    expect(mockDb.insert).not.toHaveBeenCalledWith(wallets);
    expect(mockDb.insert).toHaveBeenCalledWith(notifications);
  });

  it("acknowledges an unknown anchor transaction without touching the database", async () => {
    setupDbMocks({ transactionRow: null });

    const result = await processSep24Webhook(COMPLETED_DEPOSIT);

    expect(result).toEqual({ processed: true });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe("processWebhookRetryQueue — atomic claim and backoff timing", () => {
  function dueEvent(overrides: Partial<Parameters<WebhookRetryStore["enqueue"]>[0]> = {}) {
    return {
      eventType: "sep24_transaction",
      payload: { id: "anchor-tx-1" },
      retryCount: 0,
      maxRetries: 5,
      nextAttemptAt: new Date(NOW.getTime() - 1000),
      lastError: "failure",
      ...overrides,
    };
  }

  it("does not hand the same event to a second claim while the lease is held", async () => {
    const store = new InMemoryWebhookRetryStore();
    await store.enqueue(dueEvent());

    expect(await store.claimDue(NOW, 10)).toHaveLength(1);
    expect(await store.claimDue(NOW, 10)).toHaveLength(0);
  });

  it("makes a stale claim claimable again after the TTL", async () => {
    const store = new InMemoryWebhookRetryStore();
    await store.enqueue(dueEvent());

    await store.claimDue(NOW, 10);
    expect(await store.claimDue(NOW, 10)).toHaveLength(0);

    const afterTtl = new Date(
      NOW.getTime() + WEBHOOK_RETRY_CLAIM_TTL_MS + 1000,
    );
    expect(await store.claimDue(afterTtl, 10)).toHaveLength(1);
  });

  it("releases the claim on failure so the event can be claimed again when due", async () => {
    const store = new InMemoryWebhookRetryStore();
    await store.enqueue(dueEvent());
    const handleEvent = jest.fn().mockRejectedValue(new Error("boom"));

    await processWebhookRetryQueue({ store, handleEvent, now: () => NOW });

    const [event] = store.events;
    expect(event.retryCount).toBe(1);
    // Not claimable before its next attempt...
    expect(await store.claimDue(NOW, 10)).toHaveLength(0);
    // ...but claimable once the backoff has elapsed.
    expect(await store.claimDue(event.nextAttemptAt, 10)).toHaveLength(1);
  });

  it("starts the backoff when the attempt fails, not when the sweep started", async () => {
    const store = new InMemoryWebhookRetryStore();
    await store.enqueue(dueEvent());
    const handleEvent = jest.fn().mockRejectedValue(new Error("slow failure"));
    const failureAt = new Date(NOW.getTime() + 120_000);
    let calls = 0;
    const now = () => (++calls === 1 ? NOW : failureAt);

    await processWebhookRetryQueue({ store, handleEvent, now });

    const [event] = store.events;
    expect(event.nextAttemptAt.getTime()).toBe(
      failureAt.getTime() + computeBackoffDelayMs(1),
    );
  });
});
