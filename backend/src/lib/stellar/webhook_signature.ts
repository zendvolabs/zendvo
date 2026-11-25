import { Keypair } from "@stellar/stellar-sdk";

/**
 * Maximum age (in seconds) for a webhook callback to be considered fresh.
 * SEP-24 recommends 1–2 minutes maximum.
 */
const MAX_TIMESTAMP_AGE_SECONDS = 120;

export interface WebhookSignatureResult {
  valid: boolean;
  error?: string;
}

/**
 * Parses the SEP-24 `Signature` (or deprecated `X-Stellar-Signature`) header.
 *
 * Expected format: `t=<timestamp>, s=<base64 signature>`
 */
function parseSignatureHeader(
  headerValue: string,
): { timestamp: number; signatureBase64: string } | null {
  const parts = headerValue.split(",").map((p) => p.trim());
  if (parts.length < 2) return null;

  let timestamp: number | null = null;
  let signatureBase64: string | null = null;

  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("="); // rejoin in case value contains '='
    if (key === "t") {
      timestamp = Number(value);
    } else if (key === "s") {
      signatureBase64 = value;
    }
  }

  if (timestamp === null || !signatureBase64) return null;

  return { timestamp, signatureBase64 };
}

/**
 * Verifies a SEP-24 webhook callback signature.
 *
 * Per the SEP-24 specification:
 * 1. Parse the Signature or X-Stellar-Signature header
 * 2. Verify the timestamp is within MAX_TIMESTAMP_AGE_SECONDS
 * 3. Verify the signature over `<timestamp>.<host>.<body>` using the anchor's
 *    SIGNING_KEY (Stellar Ed25519 public key)
 *
 * @param signatureHeader - The value of the `Signature` or `X-Stellar-Signature` header
 * @param host - The host the callback was sent to (wallet hostname)
 * @param body - The raw request body string
 * @param anchorSigningKey - The anchor's SIGNING_KEY (Ed25519 public key from stellar.toml)
 * @param now - Current time in seconds since epoch (injectable for testing)
 */
export function verifyWebhookSignature(
  signatureHeader: string | null | undefined,
  host: string,
  body: string,
  anchorSigningKey: string,
  now?: number,
): WebhookSignatureResult {
  if (!signatureHeader) {
    return { valid: false, error: "Missing Signature header" };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { valid: false, error: "Malformed Signature header" };
  }

  const { timestamp, signatureBase64 } = parsed;

  // Verify timestamp freshness
  const currentTime = now ?? Math.floor(Date.now() / 1000);
  const age = Math.abs(currentTime - timestamp);
  if (age > MAX_TIMESTAMP_AGE_SECONDS) {
    return {
      valid: false,
      error: `Signature expired: timestamp is ${age}s old (max ${MAX_TIMESTAMP_AGE_SECONDS}s)`,
    };
  }

  // Verify the Ed25519 signature
  try {
    const payload = `${timestamp}.${host}.${body}`;
    const payloadBytes = Buffer.from(payload, "utf-8");
    const signatureBytes = Buffer.from(signatureBase64, "base64");

    const keypair = Keypair.fromPublicKey(anchorSigningKey);
    const valid = keypair.verify(payloadBytes, signatureBytes);

    if (!valid) {
      return { valid: false, error: "Signature verification failed" };
    }

    return { valid: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown verification error";
    return { valid: false, error: `Signature verification error: ${message}` };
  }
}
