import { NextRequest } from "next/server";

const buildCreateAccount = jest.fn();

jest.mock("@/lib/stellar/transaction_builder", () => {
  const actual = jest.requireActual("@/lib/stellar/transaction_builder");
  return {
    ...actual,
    TransactionBuilderService: jest.fn().mockImplementation(() => ({ buildCreateAccount })),
  };
});

import { POST } from "../../../src/api/wallet/activate/route";
import { ActivationError } from "@/lib/stellar/transaction_builder";

const ADDRESS = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function req(body: unknown, raw = false) {
  return new NextRequest("http://localhost/api/wallet/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe("POST /api/wallet/activate", () => {
  beforeEach(() => buildCreateAccount.mockReset());

  it("returns 200 with the unsigned envelope for publicKey", async () => {
    buildCreateAccount.mockResolvedValue({
      envelopeXdr: "XDR",
      networkPassphrase: "Test SDF Network ; September 2015",
      source: "GSOURCE",
      destination: ADDRESS,
      startingBalance: "1",
    });
    const res = await POST(req({ publicKey: ADDRESS }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.envelopeXdr).toBe("XDR");
    expect(buildCreateAccount).toHaveBeenCalledWith({ destination: ADDRESS });
  });

  it("accepts targetAddress", async () => {
    buildCreateAccount.mockResolvedValue({ envelopeXdr: "XDR" });
    const res = await POST(req({ targetAddress: ADDRESS }));
    expect(res.status).toBe(200);
    expect(buildCreateAccount).toHaveBeenCalledWith({ destination: ADDRESS });
  });

  it("returns 400 when neither field is provided", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(buildCreateAccount).not.toHaveBeenCalled();
  });

  it("returns 400 when publicKey and targetAddress differ", async () => {
    const res = await POST(req({ publicKey: ADDRESS, targetAddress: "GOTHER" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await POST(req("{nope", true));
    expect(res.status).toBe(400);
  });

  it("maps a service validation error to its status", async () => {
    buildCreateAccount.mockRejectedValue(
      new ActivationError("A valid Stellar public key (G...) is required.", "INVALID_STELLAR_ADDRESS", 400),
    );
    const res = await POST(req({ publicKey: "bad" }));
    expect(res.status).toBe(400);
  });

  it("returns 409 when the account is already active", async () => {
    buildCreateAccount.mockRejectedValue(
      new ActivationError("This Stellar account is already active.", "ACCOUNT_ALREADY_ACTIVE", 409),
    );
    const res = await POST(req({ publicKey: ADDRESS }));
    expect(res.status).toBe(409);
  });

  it("returns 500 for unexpected errors", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    buildCreateAccount.mockRejectedValue(new Error("boom"));
    const res = await POST(req({ publicKey: ADDRESS }));
    expect(res.status).toBe(500);
  });
});
