import { NextRequest } from "next/server";
import { POST } from "@/api/webhooks/sep24/route";

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock("@/lib/api-utils", () => ({
  createProblemDetails: jest.fn(
    (_type: string, title: string, status: number, detail: string) =>
      new Response(
        JSON.stringify({ type: "about:blank", title, status, detail }),
        { status, headers: { "Content-Type": "application/problem+json" } },
      ),
  ),
}));

jest.mock("@/lib/stellar/webhook_signature", () => ({
  verifyWebhookSignature: jest.fn(),
}));

jest.mock("@/server/services/webhookService", () => ({
  processSep24Webhook: jest.fn(),
  enqueueWebhookRetry: jest.fn(),
  // Pure helper — use the real implementation so the route's envelope
  // unwrapping is exercised by these tests.
  extractSep24Transaction:
    jest.requireActual("@/server/services/webhookService")
      .extractSep24Transaction,
}));

import { verifyWebhookSignature } from "@/lib/stellar/webhook_signature";
import {
  processSep24Webhook,
  enqueueWebhookRetry,
} from "@/server/services/webhookService";

const mockVerify = verifyWebhookSignature as jest.MockedFunction<
  typeof verifyWebhookSignature
>;
const mockProcess = processSep24Webhook as jest.MockedFunction<
  typeof processSep24Webhook
>;
const mockEnqueue = enqueueWebhookRetry as jest.MockedFunction<
  typeof enqueueWebhookRetry
>;

// ── Helpers ────────────────────────────────────────────────────────────────────

const SAMPLE_PAYLOAD = {
  id: "anchor-tx-123",
  kind: "deposit" as const,
  status: "completed" as const,
  asset_code: "USDC",
  amount_in: "100.00",
  amount_out: "99.50",
  amount_fee: "0.50",
  account: "GACW7NONV43MZIFHCOKCQJAKSJSISSICFVUJ2C6EZIW5773OU3HD64VI",
};

function makeRequest(
  body: unknown,
  headers?: Record<string, string>,
): NextRequest {
  const rawBody = JSON.stringify(body);
  return new NextRequest("http://localhost/api/webhooks/sep24", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost",
      ...headers,
    },
    body: rawBody,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/sep24", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
    delete process.env.SEP24_ANCHOR_SIGNING_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── Payload validation ──────────────────────────────────────────────────

  it("returns 400 when body is not valid JSON", async () => {
    const req = new NextRequest("http://localhost/api/webhooks/sep24", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: "not-json",
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.title).toBe("Bad Request");
    expect(json.detail).toContain("Invalid JSON");
  });

  // ── Signature verification ──────────────────────────────────────────────

  it("returns 401 when signature is invalid", async () => {
    process.env.SEP24_ANCHOR_SIGNING_KEY = "GANK22UVLM5TQ7LN3K7OZ3GJDYBDYXMX6RVIRZOS3HX2U7SAQ5YJPXLY";

    mockVerify.mockReturnValue({
      valid: false,
      error: "Signature verification failed",
    });

    const res = await POST(makeRequest(SAMPLE_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.title).toBe("Unauthorized");
    expect(json.detail).toContain("Signature verification failed");
  });

  it("skips signature verification when no signing key is configured (development)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SEP24_ANCHOR_SIGNING_KEY;

    mockProcess.mockResolvedValue({ processed: true });

    const res = await POST(makeRequest(SAMPLE_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("rejects unsigned webhooks in production when no signing key is configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SEP24_ANCHOR_SIGNING_KEY;

    const res = await POST(makeRequest(SAMPLE_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.detail).toContain("not configured");
  });

  it("passes correct arguments to signature verification", async () => {
    process.env.SEP24_ANCHOR_SIGNING_KEY = "SIGNING_KEY_123";

    mockVerify.mockReturnValue({ valid: true });
    mockProcess.mockResolvedValue({ processed: true });

    const body = SAMPLE_PAYLOAD;
    const req = makeRequest(body, {
      signature: "t=1234567890, s=abc123",
    });

    await POST(req);

    expect(mockVerify).toHaveBeenCalledWith(
      "t=1234567890, s=abc123",
      "localhost",
      JSON.stringify(body),
      "SIGNING_KEY_123",
    );
  });

  it("prefers Signature header over X-Stellar-Signature", async () => {
    process.env.SEP24_ANCHOR_SIGNING_KEY = "SIGNING_KEY_123";

    mockVerify.mockReturnValue({ valid: true });
    mockProcess.mockResolvedValue({ processed: true });

    const req = makeRequest(SAMPLE_PAYLOAD, {
      signature: "t=111, s=primary",
      "x-stellar-signature": "t=222, s=deprecated",
    });

    await POST(req);

    expect(mockVerify.mock.calls[0][0]).toBe("t=111, s=primary");
  });

  // ── Processing success ──────────────────────────────────────────────────

  it("returns 200 when webhook is processed successfully", async () => {
    process.env.SEP24_ANCHOR_SIGNING_KEY = "SIGNING_KEY";

    mockVerify.mockReturnValue({ valid: true });
    mockProcess.mockResolvedValue({ processed: true });

    const res = await POST(makeRequest(SAMPLE_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toBe("Webhook processed");
  });

  // ── SEP-24 envelope ─────────────────────────────────────────────────────

  it("unwraps the { transaction } envelope before processing", async () => {
    process.env.SEP24_ANCHOR_SIGNING_KEY = "SIGNING_KEY";

    mockVerify.mockReturnValue({ valid: true });
    mockProcess.mockResolvedValue({ processed: true });

    const res = await POST(makeRequest({ transaction: SAMPLE_PAYLOAD }));
    const json = await res.json();

    expect(res.status).toBe(200);
    // The service receives the transaction itself, not the envelope.
    expect(mockProcess).toHaveBeenCalledWith(SAMPLE_PAYLOAD);
    // Signature verification still ran over the untouched raw body.
    expect(mockVerify.mock.calls[0][2]).toBe(
      JSON.stringify({ transaction: SAMPLE_PAYLOAD }),
    );
  });

  it("enqueues the unwrapped transaction when an enveloped callback fails", async () => {
    process.env.SEP24_ANCHOR_SIGNING_KEY = "SIGNING_KEY";

    mockVerify.mockReturnValue({ valid: true });
    mockProcess.mockResolvedValue({
      processed: false,
      error: "Missing transaction id in payload",
    });
    mockEnqueue.mockResolvedValue(undefined as never);

    const res = await POST(makeRequest({ transaction: SAMPLE_PAYLOAD }));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(mockEnqueue).toHaveBeenCalledWith(
      "sep24_transaction",
      SAMPLE_PAYLOAD,
      "Missing transaction id in payload",
    );
  });

  // ── Processing failure ──────────────────────────────────────────────────

  it("returns 422 when processing fails and enqueues for retry", async () => {
    process.env.SEP24_ANCHOR_SIGNING_KEY = "SIGNING_KEY";

    mockVerify.mockReturnValue({ valid: true });
    mockProcess.mockResolvedValue({
      processed: false,
      error: "Invalid transaction kind: transfer",
    });
    mockEnqueue.mockResolvedValue(undefined as never);

    const res = await POST(makeRequest(SAMPLE_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.title).toBe("Processing Error");
    expect(mockEnqueue).toHaveBeenCalledWith(
      "sep24_transaction",
      SAMPLE_PAYLOAD,
      "Invalid transaction kind: transfer",
    );
  });

  it("returns 500 and enqueues for retry on unexpected errors", async () => {
    process.env.SEP24_ANCHOR_SIGNING_KEY = "SIGNING_KEY";

    mockVerify.mockReturnValue({ valid: true });
    mockProcess.mockRejectedValue(new Error("database down"));
    mockEnqueue.mockResolvedValue(undefined as never);

    const res = await POST(makeRequest(SAMPLE_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.title).toBe("Internal Server Error");
    expect(mockEnqueue).toHaveBeenCalledWith(
      "sep24_transaction",
      SAMPLE_PAYLOAD,
      "database down",
    );
  });
});
