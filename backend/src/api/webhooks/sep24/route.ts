import { NextRequest } from "next/server";
import { createProblemDetails } from "@/lib/api-utils";
import { verifyWebhookSignature } from "@/lib/stellar/webhook_signature";
import {
  processSep24Webhook,
  enqueueWebhookRetry,
  type Sep24TransactionPayload,
} from "@/server/services/webhookService";

/**
 * SEP-24 Webhook Listener
 *
 * Receives POST callbacks from SEP-24 anchors when a transaction status
 * changes. Verifies the callback signature per the SEP-24 specification,
 * then processes the event to update internal state.
 *
 * Signature verification:
 * - Reads `Signature` or `X-Stellar-Signature` header
 * - Validates timestamp freshness (≤ 2 minutes)
 * - Verifies Ed25519 signature over `<timestamp>.<host>.<body>`
 *   using the anchor's SIGNING_KEY from its stellar.toml
 *
 * The anchor's SIGNING_KEY must be configured via:
 *   SEP24_ANCHOR_SIGNING_KEY=<Ed25519 public key>
 */
export async function POST(request: NextRequest) {
  let rawBody = "{}";
  try {
    // Read the raw body for signature verification
    rawBody = await request.text();

    let payload: Sep24TransactionPayload;
    try {
      payload = JSON.parse(rawBody) as Sep24TransactionPayload;
    } catch {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid JSON payload",
      );
    }

    // Verify the callback signature
    const signatureHeader =
      request.headers.get("signature") ||
      request.headers.get("x-stellar-signature");

    const anchorSigningKey = process.env.SEP24_ANCHOR_SIGNING_KEY;
    const host = request.headers.get("host") || "localhost";

    if (anchorSigningKey) {
      const sigResult = verifyWebhookSignature(
        signatureHeader,
        host,
        rawBody,
        anchorSigningKey,
      );

      if (!sigResult.valid) {
        console.warn(
          `[SEP24_WEBHOOK] Signature verification failed: ${sigResult.error}`,
        );
        return createProblemDetails(
          "about:blank",
          "Unauthorized",
          401,
          sigResult.error || "Invalid webhook signature",
        );
      }
    } else {
      // In development, warn but allow unsigned webhooks through
      if (process.env.NODE_ENV === "production") {
        console.error(
          "[SEP24_WEBHOOK] SEP24_ANCHOR_SIGNING_KEY not configured in production!",
        );
        return createProblemDetails(
          "about:blank",
          "Internal Server Error",
          500,
          "Webhook signature verification not configured",
        );
      }
      console.warn(
        "[SEP24_WEBHOOK] Skipping signature verification (no SEP24_ANCHOR_SIGNING_KEY configured)",
      );
    }

    // Process the webhook event
    const result = await processSep24Webhook(payload);

    if (!result.processed) {
      // Enqueue for retry on processing failure
      await enqueueWebhookRetry(
        "sep24_transaction",
        payload as unknown as Record<string, unknown>,
        result.error || "Processing failed",
      );

      return createProblemDetails(
        "about:blank",
        "Processing Error",
        422,
        result.error || "Failed to process webhook event",
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Webhook processed" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[SEP24_WEBHOOK_ERROR]", error);

    // Enqueue for retry on unexpected errors
    try {
      const parsedBody = JSON.parse(rawBody) || {};
      await enqueueWebhookRetry(
        "sep24_transaction",
        parsedBody,
        error instanceof Error ? error.message : "Unknown error",
      );
    } catch {
      // Ignore enqueue errors — don't mask the original error
    }

    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to process webhook",
    );
  }
}
