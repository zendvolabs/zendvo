import cron from "node-cron";
import {
  processWebhookRetryQueue,
  type WebhookRetrySummary,
} from "@/server/services/webhookService";

const DEFAULT_SCHEDULE = "*/1 * * * *";

/** Creates an overlap-safe callback for scheduled retry sweeps. */
export function createWebhookRetryRunner(
  processQueue: () => Promise<WebhookRetrySummary> = () =>
    processWebhookRetryQueue(),
) {
  let isProcessing = false;

  return async () => {
    if (isProcessing) {
      console.warn(
        "[Webhook Retry] Previous execution is still active. Skipping tick.",
      );
      return;
    }

    isProcessing = true;
    try {
      const summary = await processQueue();
      console.log(
        `[Webhook Retry] Checked ${summary.checked}; succeeded ${summary.succeeded}; failed ${summary.failed}; dead-lettered ${summary.deadLettered}.`,
      );
    } catch (error) {
      console.error("[Webhook Retry] Sweep failed:", error);
    } finally {
      isProcessing = false;
    }
  };
}

/**
 * Registers the webhook retry queue processor with the configured cron
 * schedule (default: every minute). Override with WEBHOOK_RETRY_CRON.
 */
export function startWebhookRetryJob(
  schedule = process.env.WEBHOOK_RETRY_CRON || DEFAULT_SCHEDULE,
) {
  return cron.schedule(schedule, createWebhookRetryRunner());
}
