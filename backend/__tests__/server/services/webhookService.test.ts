import {
  computeBackoffDelayMs,
  enqueueWebhookRetry,
  handleQueuedWebhookEvent,
  processSep24Webhook,
  processWebhookRetryQueue,
  WEBHOOK_RETRY_BASE_DELAY_MS,
  WEBHOOK_RETRY_MAX_DELAY_MS,
  type WebhookRetryEvent,
  type WebhookRetryStore,
} from "@/server/services/webhookService";

/** In-memory fake of the WebhookRetryQueue table for processor tests. */
class InMemoryWebhookRetryStore implements WebhookRetryStore {
  events: WebhookRetryEvent[] = [];
  private seq = 0;

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

  async listDue(now: Date, limit: number): Promise<WebhookRetryEvent[]> {
    return this.events
      .filter((e) => e.nextAttemptAt <= now)
      .sort(
        (a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime(),
      )
      .slice(0, limit);
  }

  async remove(id: string): Promise<void> {
    this.events = this.events.filter((e) => e.id !== id);
  }

  async recordFailure(
    id: string,
    update: { retryCount: number; nextAttemptAt: Date; lastError: string },
  ): Promise<void> {
    const event = this.events.find((e) => e.id === id);
    if (event) {
      Object.assign(event, update, { updatedAt: new Date() });
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
