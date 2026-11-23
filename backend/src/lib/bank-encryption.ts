import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";

/**
 * Field-level protection for bank account numbers.
 *
 * - Encryption: AES-256-GCM with a fresh random 96-bit IV per value.
 * - Deduplication: deterministic HMAC-SHA256 ("blind index") computed with a
 *   key that is separate from the encryption key, so fingerprints reveal
 *   nothing without the HMAC key and cannot be brute-forced offline.
 *
 * Keys come from the environment and the module fails closed: there are no
 * fallback/default keys.
 *
 *   BANK_ACCOUNT_ENCRYPTION_KEY          32 bytes, hex (64 chars) or base64
 *   BANK_ACCOUNT_ENCRYPTION_KEY_VERSION  positive integer (default 1)
 *   BANK_ACCOUNT_FINGERPRINT_KEY         >= 32 bytes, hex or base64
 */

export class BankEncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankEncryptionConfigError";
  }
}

export interface EncryptedAccountNumber {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

const IV_BYTES = 12;
const KEY_BYTES = 32;
const MIN_FINGERPRINT_KEY_BYTES = 32;

function decodeKey(raw: string | undefined, name: string, minBytes: number) {
  if (!raw) {
    throw new BankEncryptionConfigError(`${name} is not configured`);
  }
  const value = raw.trim();
  const buf = /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (buf.length < minBytes) {
    throw new BankEncryptionConfigError(
      `${name} must decode to at least ${minBytes} bytes`,
    );
  }
  return buf;
}

function getEncryptionKey(): { key: Buffer; version: number } {
  const key = decodeKey(
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY,
    "BANK_ACCOUNT_ENCRYPTION_KEY",
    KEY_BYTES,
  );
  if (key.length !== KEY_BYTES) {
    throw new BankEncryptionConfigError(
      `BANK_ACCOUNT_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes`,
    );
  }
  const rawVersion = process.env.BANK_ACCOUNT_ENCRYPTION_KEY_VERSION;
  const version = rawVersion === undefined || rawVersion === "" ? 1 : Number(rawVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new BankEncryptionConfigError(
      "BANK_ACCOUNT_ENCRYPTION_KEY_VERSION must be a positive integer",
    );
  }
  return { key, version };
}

/** Strips spaces/hyphens and upper-cases so equivalent inputs fingerprint identically. */
export function normalizeAccountNumber(accountNumber: string): string {
  return accountNumber.replace(/[\s-]/g, "").toUpperCase();
}

export function fingerprintAccountNumber(accountNumber: string): string {
  const key = decodeKey(
    process.env.BANK_ACCOUNT_FINGERPRINT_KEY,
    "BANK_ACCOUNT_FINGERPRINT_KEY",
    MIN_FINGERPRINT_KEY_BYTES,
  );
  return createHmac("sha256", key)
    .update(normalizeAccountNumber(accountNumber), "utf8")
    .digest("hex");
}

export function encryptAccountNumber(accountNumber: string): EncryptedAccountNumber {
  const { key, version } = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalizeAccountNumber(accountNumber), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: version,
  };
}

export function decryptAccountNumber(
  payload: Pick<EncryptedAccountNumber, "ciphertext" | "iv" | "authTag">,
): string {
  const { key } = getEncryptionKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
