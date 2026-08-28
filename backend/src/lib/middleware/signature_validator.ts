/**
 * validateRequestSignature
 *
 * Express middleware that protects sensitive wallet endpoints by verifying that
 * the incoming request was cryptographically signed by the user's registered
 * Stellar Ed25519 key pair.
 *
 * ── Client-side protocol ──────────────────────────────────────────────────────
 * 1. Build a payload string:
 *      `<ISO-8601 UTC timestamp>.<SHA-256 hex of raw request body>`
 *    e.g. "2026-08-28T12:00:00.000Z.e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
 *    Use an empty-string hash for requests with no body.
 *
 * 2. Sign the UTF-8 bytes of that payload string with the user's Stellar secret key:
 *      signature = keypair.sign(Buffer.from(payloadString, "utf8"))
 *
 * 3. Base64-encode the raw 64-byte signature and send both values as headers:
 *      X-Signature-Payload : <payload string from step 1>
 *      X-Signature         : <base64-encoded signature from step 2>
 *
 * ── Server-side (this middleware) ────────────────────────────────────────────
 * 1. Require a valid JWT (Authorization: Bearer …) — userId is extracted from it.
 * 2. Read X-Signature-Payload and X-Signature headers.
 * 3. Parse and validate the timestamp embedded in the payload (reject if > 5 min old).
 * 4. Fetch the user's registered stellarAddress from the database.
 * 5. Decode the base64 signature (must be exactly 64 bytes for Ed25519).
 * 6. Verify via Stellar SDK's Keypair.verify(data, signature).
 * 7. Call next() on success; respond with 401 on any failure.
 */

import type { Request, Response, NextFunction } from "express";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyAccessToken } from "@/lib/tokens";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum age (ms) of a signed payload before the request is rejected as a
 * potential replay. 5 minutes is a standard tolerance that handles reasonable
 * clock drift while remaining narrow enough to block replays.
 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts and verifies the Bearer JWT from the Authorization header.
 * Returns the userId string on success, or null if absent / invalid.
 */
async function extractUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return null;

  const payload = await verifyAccessToken(token);
  return payload?.userId ?? null;
}

/**
 * Parses the timestamp from a payload string formatted as:
 *   `<ISO-8601 timestamp>.<sha256-hex>`
 * Returns a Date on success, or null if the format / timestamp is invalid.
 */
function parsePayloadTimestamp(sigPayload: string): Date | null {
  const dotIndex = sigPayload.indexOf(".");
  if (dotIndex === -1) return null;

  const timestampStr = sigPayload.substring(0, dotIndex);
  const parsed = new Date(timestampStr);

  return isNaN(parsed.getTime()) ? null : parsed;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that validates a Stellar cryptographic signature on the
 * incoming request. Attach this before the route handler on any endpoint that
 * performs a sensitive wallet operation.
 *
 * @example
 *   import { validateRequestSignature } from "@/lib/middleware/signature_validator";
 *   apiRouter.post("/api/wallet/withdraw", validateRequestSignature, makeExpressHandler(withdrawPost));
 */
export async function validateRequestSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // ── 1. Require a valid JWT and extract userId ──────────────────────────────
  let userId: string | null = null;
  try {
    userId = await extractUserId(req);
  } catch {
    // fall through — userId stays null, rejected below
  }

  if (!userId) {
    res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "A valid Bearer token is required.",
    });
    return;
  }

  // ── 2. Extract signature headers ───────────────────────────────────────────
  const rawSigPayload = req.headers["x-signature-payload"];
  const rawSig = req.headers["x-signature"];

  const sigPayload =
    typeof rawSigPayload === "string" ? rawSigPayload.trim() : null;
  const sigEncoded =
    typeof rawSig === "string" ? rawSig.trim() : null;

  if (!sigPayload || !sigEncoded) {
    res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail:
        "Request is missing required signature headers " +
        "(X-Signature-Payload and X-Signature).",
    });
    return;
  }

  // ── 3. Validate the timestamp to prevent replay attacks ────────────────────
  const payloadTimestamp = parsePayloadTimestamp(sigPayload);

  if (!payloadTimestamp) {
    res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail:
        "X-Signature-Payload has an invalid format. " +
        "Expected: <ISO-8601 timestamp>.<SHA-256 body hash>",
    });
    return;
  }

  const ageMs = Date.now() - payloadTimestamp.getTime();
  if (ageMs < 0 || ageMs > TIMESTAMP_TOLERANCE_MS) {
    res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail:
        "Signature payload has expired or has a future timestamp. " +
        "Ensure your system clock is accurate and retry within 5 minutes.",
    });
    return;
  }

  // ── 4. Look up the user's registered Stellar address ──────────────────────
  let stellarAddress: string | null = null;
  try {
    const [user] = await db
      .select({ stellarAddress: users.stellarAddress })
      .from(users)
      .where(eq(users.id, userId));

    stellarAddress = user?.stellarAddress ?? null;
  } catch (dbError) {
    console.error("[SIGNATURE_VALIDATOR] DB error fetching user:", dbError);
    res.status(500).json({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      detail: "Failed to validate request signature due to a server error.",
    });
    return;
  }

  if (!stellarAddress) {
    res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail:
        "No Stellar address is registered for this account. " +
        "Register a Stellar address before performing this operation.",
    });
    return;
  }

  // Sanity-check the stored address before constructing a Keypair
  if (!StrKey.isValidEd25519PublicKey(stellarAddress)) {
    console.error(
      "[SIGNATURE_VALIDATOR] Malformed stellarAddress in DB for userId:",
      userId,
    );
    res.status(500).json({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      detail:
        "The registered Stellar address is malformed. Please contact support.",
    });
    return;
  }

  // ── 5. Decode the base64 signature ─────────────────────────────────────────
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(sigEncoded, "base64");
    // Ed25519 signatures are always exactly 64 bytes
    if (signatureBytes.length !== 64) {
      throw new Error(
        `Invalid signature length: expected 64 bytes, got ${signatureBytes.length}`,
      );
    }
  } catch {
    res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail:
        "X-Signature is not a valid base64-encoded Ed25519 signature (must decode to 64 bytes).",
    });
    return;
  }

  // ── 6. Verify using the Stellar SDK ────────────────────────────────────────
  try {
    const keypair = Keypair.fromPublicKey(stellarAddress);
    const dataBytes = Buffer.from(sigPayload, "utf8");
    const isValid = keypair.verify(dataBytes, signatureBytes);

    if (!isValid) {
      res.status(401).json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Cryptographic signature verification failed.",
      });
      return;
    }
  } catch (verifyError) {
    console.error(
      "[SIGNATURE_VALIDATOR] Unexpected error during verification:",
      verifyError,
    );
    res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "Cryptographic signature verification failed.",
    });
    return;
  }

  // ── 7. All checks passed — hand off to the route handler ──────────────────
  next();
}
