import { StrKey, TransactionBuilder, Networks, Keypair } from "@stellar/stellar-sdk";
import { transactions, users } from "@/lib/db/schema";
import { TelemetryService } from "@/lib/services/telemetry_service";
export interface SubmitXdrResponse {
  hash: string;
  fee: number;
  operationCount: number;
  resultXdr?: string;
  resultMetaXdr?: string;
  txXdr?: string;
}

export interface SubmissionResult {
  success: boolean;
  hash?: string;
  error?: string;
  status?: string;
  attempts: number;
}

export class SubmissionService {
  private static MAX_RETRIES = 5;
  private static BASE_DELAY_MS = 1000;
  private static MAX_DELAY_MS = 30000;

  static async submitXdrToNetwork(
    signedXdr: string,
    userStellarAddress: string,
    maxRetries?: number
  ): Promise<SubmissionResult> {
    const retries = maxRetries ?? SubmissionService.MAX_RETRIES;
    let lastError: Error | null = null;
    let attempts = 0;

    for (let attempt = 1; attempt <= retries; attempt++) {
      attempts = attempt;
      try {
        const result = await SubmissionService.submitAttempt(signedXdr, userStellarAddress);
        if (result.success) {
          return {
            success: true,
            hash: result.hash,
            status: "success",
            attempts: attempt,
          };
        }
        lastError = new Error(result.error || "Unknown submission error");
        
        if (result.isRetryable === false) {
          break; // Stop immediately for permanent failures
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown submission error");
      }

      // If this is the last attempt, break without waiting
      if (attempt >= retries) {
        break;
      }

      // Calculate exponential backoff delay
      const delay = Math.min(
        SubmissionService.BASE_DELAY_MS * 2 ** (attempt - 1),
        SubmissionService.MAX_DELAY_MS
      );

      await SubmissionService.sleep(delay);
    }

    return {
      success: false,
      error: lastError?.message || "Max retries exceeded",
      status: "failed",
      attempts,
    };
  }

  private static async submitAttempt(signedXdr: string, userStellarAddress: string): Promise<{ success: boolean; hash?: string; error?: string; isRetryable?: boolean }> {
    // Validate that the XDR is a valid base64 string
    if (!signedXdr || typeof signedXdr !== "string") {
      return { success: false, error: "Invalid XDR: must be a non-empty string", isRetryable: false };
    }

    try {
      const networkPassphrase = process.env.STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET;
      const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
      
      const keypair = Keypair.fromPublicKey(userStellarAddress);
      let isSigned = false;
      for (const sig of tx.signatures) {
        if (keypair.verify(tx.hash(), sig.signature())) {
          isSigned = true;
          break;
        }
      }
      
      if (!isSigned) {
        return { success: false, error: "Unauthorized: transaction is not signed by the user", isRetryable: false };
      }
    } catch {
      return { success: false, error: "Invalid XDR format: decoding failed", isRetryable: false };
    }

    try {
      // Submit the XDR to Horizon
      const horizonUrl = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let response;
      try {
        response = await fetch(`${horizonUrl}/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `tx=${encodeURIComponent(signedXdr)}`,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage = `Horizon responded with ${response.status}`;

        // Check if it's a known retryable error
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          TelemetryService.log({
            level: "warn",
            event: "stellar.horizon_submission.attempt_retryable_error",
            stage: "network_submission",
            status: "failed",
            stellarAddress: userStellarAddress,
            errorCode: response.status,
            errorMessage,
            metadata: { isRetryable: true },
          });
          return { success: false, error: `Network error (${response.status}): ${errorMessage}`, isRetryable: true };
        }

        try {
          const errorJson = JSON.parse(errorBody);
          if (errorJson.extras && errorJson.extras.result_codes) {
            errorMessage = `Transaction failed: ${errorJson.extras.result_codes.transaction || JSON.stringify(errorJson.extras.result_codes)}`;
          } else if (errorJson.type) {
            errorMessage = `Horizon error: ${errorJson.type} - ${errorJson.explanation || errorMessage}`;
          }
        } catch {
          errorMessage = `Horizon error: ${response.status} - ${errorBody}`;
        }

        TelemetryService.log({
          level: "error",
          event: "stellar.horizon_submission.attempt_permanent_error",
          stage: "network_submission",
          status: "failed",
          stellarAddress: userStellarAddress,
          errorCode: response.status,
          errorMessage,
          metadata: { isRetryable: false },
        });

        return { success: false, error: errorMessage, isRetryable: false };
      }

      const data = (await response.json()) as SubmitXdrResponse;

      if (!data.hash) {
        return { success: false, error: "Submission succeeded but no hash returned from Horizon", isRetryable: false };
      }

      TelemetryService.log({
        level: "info",
        event: "stellar.horizon_submission.attempt_succeeded",
        stage: "network_submission",
        status: "completed",
        stellarAddress: userStellarAddress,
        txHash: data.hash,
      });

      return {
        success: true,
        hash: data.hash,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown submission error");

      // Network errors or timeouts - retryable
      if (
        err.name === "AbortError" ||
        err.message.includes("timeout") ||
        err.message.includes("network") ||
        err instanceof TypeError
      ) {
        throw err; // Will be caught by the retry loop
      }

      return { success: false, error: err.message, isRetryable: false };
    }
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}