import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyAccessToken } from "@/lib/tokens";

/**
 * Express middleware: `validateRequestSignature`
 * ------------------------------------------------
 * Verifies that a request was cryptographically signed by the caller's
 * *registered* Stellar keypair, protecting sensitive wallet endpoints
 * (withdraw, register wallet, add trustline, etc.) from tampering, replay,
 * and unauthorized calls even if a session token leaks.
 *
 * Required headers on the protected request:
 *   Authorization : Bearer <JWT access token>   (identifies the user)
 *   X-Signature   : base64(Ed25519 signature)
 *   X-Timestamp   : unix time (seconds) the signature was produced at
 *
 * Signed (canonical) payload the client must produce and sign client-side:
 *   `${timestamp}:${HTTP_METHOD}:${request_path}:${sha256_hex(raw_body)}`
 * Registration (submitted-key mode) appends `:${authenticated_user_id}`.
 *
 * Usage:
 *   apiRouter.post(
 *     "/api/wallet/withdraw",
 *     validateRequestSignature,
 *     makeExpressHandler(walletWithdrawPost),
 *   );
 */

/** Signatures older or newer than this many seconds are rejected. */
const SIGNATURE_WINDOW_SECONDS = 300; // 5 minutes
const MAX_REGISTRATION_BODY_BYTES = 8 * 1024;
const NONCE_RETENTION_SECONDS = SIGNATURE_WINDOW_SECONDS * 2 + 1;

class RequestBodyTooLargeError extends Error {}

function isFreshTimestamp(timestamp: number): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - timestamp) <= SIGNATURE_WINDOW_SECONDS;
}

// ─── Nonce Store ────────────────────────────────────────────────────────────
/**
 * In-memory store of consumed (userId, timestamp, signature) triples.
 * Prevents a captured, still-fresh signed request from being replayed
 * within the validity window.
 *
 * NOTE: this is process-local. If the backend ever runs multiple instances
 * behind a load balancer, swap this for a shared store (e.g. Redis) so
 * replay protection holds across instances.
 */
class NonceStore {
  private store = new Map<string, number>();

  private evict(): void {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.store) {
      if (now >= expiresAt) this.store.delete(nonce);
    }
  }

  has(nonce: string): boolean {
    this.evict();
    return this.store.has(nonce);
  }

  set(nonce: string, ttlSeconds: number): void {
    this.evict();
    this.store.set(nonce, Date.now() + ttlSeconds * 1000);
  }
}

const nonceStore = new NonceStore();

type RequestWithSignatureOptions = Request & {
  rawBody?: Buffer;
  signaturePublicKeySource?: "registered" | "submitted";
};

export function useSubmittedStellarAddressForSignature(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  (req as RequestWithSignatureOptions).signaturePublicKeySource = "submitted";
  next();
}

function getSubmittedStellarAddress(rawBody: Buffer): string | null {
  try {
    const body: unknown = JSON.parse(rawBody.toString("utf8"));
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const value = (body as { stellarAddress?: unknown }).stellarAddress;
    if (typeof value !== "string") {
      return null;
    }

    const address = value.trim();
    return StrKey.isValidEd25519PublicKey(address) ? address : null;
  } catch {
    return null;
  }
}

function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Buffers the raw request body before any body-parser touches it, so the
 * hash we verify against matches exactly what the client signed (a
 * re-serialized `JSON.stringify(req.body)` can differ byte-for-byte from
 * what was actually sent and signed).
 */
function readRawBody(req: Request, maxBytes?: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let settled = false;

    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
    };

    const onData = (chunk: Buffer) => {
      if (settled) {
        return;
      }

      receivedBytes += chunk.length;
      if (maxBytes !== undefined && receivedBytes > maxBytes) {
        settled = true;
        cleanup();
        req.pause();
        reject(new RequestBodyTooLargeError());
        return;
      }

      chunks.push(chunk);
    };

    const onEnd = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onError = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

export async function validateRequestSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // ── 1. Header extraction ────────────────────────────────────────────────
    const signatureHeader = req.header("x-signature");
    const timestampHeader = req.header("x-timestamp");

    if (!signatureHeader) {
      res.status(401).json({ error: "Missing X-Signature header" });
      return;
    }
    if (!timestampHeader) {
      res.status(401).json({ error: "Missing X-Timestamp header" });
      return;
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      res.status(400).json({ error: "Invalid X-Timestamp value" });
      return;
    }

    // ── 2. Timestamp freshness (also blocks stale/expired signatures) ──────
    if (!isFreshTimestamp(timestamp)) {
      res.status(401).json({ error: "Request timestamp expired" });
      return;
    }

    // ── 3. Identify the caller via their access token ──────────────────────
    const authHeader = req.header("authorization");
    if (!authHeader) {
      res.status(401).json({ error: "Unauthenticated request" });
      return;
    }
    const [scheme, token] = authHeader.split(" ");
    if (!token || scheme.toLowerCase() !== "bearer") {
      res.status(401).json({ error: "Malformed Authorization header" });
      return;
    }

    const authPayload = await verifyAccessToken(token);
    if (!authPayload) {
      res.status(401).json({ error: "Invalid or expired access token" });
      return;
    }
    const { userId } = authPayload;

    const requestWithOptions = req as RequestWithSignatureOptions;
    const usesSubmittedKey =
      requestWithOptions.signaturePublicKeySource === "submitted";

    let rawBody: Buffer;
    try {
      rawBody =
        req.method === "GET" || req.method === "HEAD"
          ? Buffer.alloc(0)
          : await readRawBody(
              req,
              usesSubmittedKey ? MAX_REGISTRATION_BODY_BYTES : undefined,
            );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        res.status(413).json({ error: "Request body too large" });
        return;
      }
      throw error;
    }
    requestWithOptions.rawBody = rawBody;

    let stellarAddress: string | null;
    if (usesSubmittedKey) {
      stellarAddress = getSubmittedStellarAddress(rawBody);
      if (!stellarAddress) {
        res.status(400).json({
          error: "Missing or invalid stellarAddress to verify signature",
        });
        return;
      }
    } else {
      try {
        const [row] = await db
          .select({ stellarAddress: users.stellarAddress })
          .from(users)
          .where(eq(users.id, userId));
        stellarAddress = row?.stellarAddress ?? null;
      } catch {
        res.status(500).json({ error: "Internal error during key lookup" });
        return;
      }

      if (!stellarAddress) {
        res
          .status(401)
          .json({ error: "No Stellar public key on record for user" });
        return;
      }
    }

    if (!isFreshTimestamp(timestamp)) {
      res.status(401).json({ error: "Request timestamp expired" });
      return;
    }

    const bodyHash = sha256Hex(rawBody);
    const canonicalPayload = usesSubmittedKey
      ? `${timestamp}:${req.method.toUpperCase()}:${req.originalUrl}:${bodyHash}:${userId}`
      : `${timestamp}:${req.method.toUpperCase()}:${req.originalUrl}:${bodyHash}`;
    const payloadBuffer = Buffer.from(canonicalPayload, "utf8");

    // ── 6. Verify the Ed25519 signature via @stellar/stellar-sdk ────────────
    let signatureBuffer: Buffer;
    try {
      signatureBuffer = Buffer.from(signatureHeader, "base64");
    } catch {
      res.status(400).json({ error: "Malformed signature encoding" });
      return;
    }

    let verified: boolean;
    try {
      verified = Keypair.fromPublicKey(stellarAddress).verify(
        payloadBuffer,
        signatureBuffer,
      );
    } catch {
      res.status(400).json({ error: "Signature verification failed" });
      return;
    }

    if (!verified) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // ── 7. Replay protection ────────────────────────────────────────────────
    const nonce = `${userId}:${timestamp}:${sha256Hex(payloadBuffer)}:${sha256Hex(signatureBuffer)}`;
    if (nonceStore.has(nonce)) {
      res
        .status(401)
        .json({ error: "Duplicate request detected (possible replay)" });
      return;
    }
    nonceStore.set(nonce, NONCE_RETENTION_SECONDS);

    // ── All checks passed ─────────────────────────────────────────────────
    next();
  } catch (error) {
    console.error("[SIGNATURE_VALIDATOR_ERROR]", error);
    res
      .status(500)
      .json({ error: "Internal error validating request signature" });
  }
}