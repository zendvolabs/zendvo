import { Keypair } from "@stellar/stellar-sdk";
import { verifyWebhookSignature } from "@/lib/stellar/webhook_signature";

describe("verifyWebhookSignature", () => {
  const HOST = "wallet.example.com";
  const BODY = '{"id":"tx-1","status":"completed"}';
  const NOW = 1_700_000_000;

  // The anchor's real Ed25519 keypair — tests sign with the secret key and
  // verify against the public key, exactly like a production callback.
  const anchor = Keypair.random();
  const otherAnchor = Keypair.random();

  function signHeader(
    signer: Keypair,
    timestamp: number,
    host: string,
    body: string,
  ): string {
    const payload = `${timestamp}.${host}.${body}`;
    const signature = signer
      .sign(Buffer.from(payload, "utf-8"))
      .toString("base64");
    return `t=${timestamp}, s=${signature}`;
  }

  it("returns valid for a correct signature and fresh timestamp", () => {
    const header = signHeader(anchor, NOW, HOST, BODY);

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      anchor.publicKey(),
      NOW,
    );

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts a timestamp exactly at the 2 minute boundary", () => {
    const header = signHeader(anchor, NOW - 120, HOST, BODY);

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      anchor.publicKey(),
      NOW,
    );

    expect(result.valid).toBe(true);
  });

  it("rejects a stale timestamp (>2 minutes old)", () => {
    const header = signHeader(anchor, NOW - 121, HOST, BODY);

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      anchor.publicKey(),
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("rejects a timestamp too far in the future", () => {
    const header = signHeader(anchor, NOW + 121, HOST, BODY);

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      anchor.publicKey(),
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("rejects a signature made by a different keypair", () => {
    const header = signHeader(otherAnchor, NOW, HOST, BODY);

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      anchor.publicKey(),
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Signature verification failed");
  });

  it("rejects a signature made for a different host", () => {
    const header = signHeader(anchor, NOW, "evil.example.com", BODY);

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      anchor.publicKey(),
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Signature verification failed");
  });

  it("rejects a tampered body", () => {
    const header = signHeader(anchor, NOW, HOST, BODY);

    const result = verifyWebhookSignature(
      header,
      HOST,
      '{"id":"tx-1","status":"refunded"}',
      anchor.publicKey(),
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Signature verification failed");
  });

  it("rejects a signature verified against the wrong anchor key", () => {
    const header = signHeader(anchor, NOW, HOST, BODY);

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      otherAnchor.publicKey(),
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Signature verification failed");
  });

  it("returns invalid when the Signature header is missing", () => {
    expect(
      verifyWebhookSignature(null, HOST, BODY, anchor.publicKey(), NOW),
    ).toEqual({ valid: false, error: "Missing Signature header" });
    expect(
      verifyWebhookSignature(undefined, HOST, BODY, anchor.publicKey(), NOW),
    ).toEqual({ valid: false, error: "Missing Signature header" });
  });

  it("returns invalid for a malformed header", () => {
    for (const header of [
      "not-a-signature-header",
      "t=1700000000",
      "s=YWJj",
      "t=not-a-number, s=YWJj",
    ]) {
      const result = verifyWebhookSignature(
        header,
        HOST,
        BODY,
        anchor.publicKey(),
        NOW,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Malformed|expired|verification/i);
    }
  });

  it("returns invalid for a garbage signature value", () => {
    const result = verifyWebhookSignature(
      `t=${NOW}, s=!!!not-base64!!!`,
      HOST,
      BODY,
      anchor.publicKey(),
      NOW,
    );

    // The SDK throws on a wrong-length signature, so it surfaces as a
    // verification error — either way the webhook is rejected.
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Signature verification error");
  });

  it("returns an error for an invalid anchor public key", () => {
    const header = signHeader(anchor, NOW, HOST, BODY);

    const result = verifyWebhookSignature(
      header,
      HOST,
      BODY,
      "not-a-stellar-key",
      NOW,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Signature verification error");
  });
});
