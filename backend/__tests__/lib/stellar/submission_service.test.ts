import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  SubmissionError,
  SubmissionService,
  getEnvelopeSourceAccount,
  parseSignedXdr,
} from "../../../src/lib/stellar/submission_service";

/** Builds a real signed payment envelope for the given source keypair. */
function buildSignedXdr(source: Keypair): string {
  const transaction = new TransactionBuilder(
    new Account(source.publicKey(), "1"),
    { fee: "100", networkPassphrase: Networks.TESTNET },
  )
    .addOperation(
      Operation.payment({
        destination: source.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(30)
    .build();
  transaction.sign(source);
  return transaction.toEnvelope().toXDR("base64");
}

function buildFeeBumpXdr(
  feeSource: Keypair,
  innerSource: Keypair,
): string {
  const inner = new TransactionBuilder(
    new Account(innerSource.publicKey(), "1"),
    { fee: "100", networkPassphrase: Networks.TESTNET },
  )
    .addOperation(
      Operation.payment({
        destination: innerSource.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(30)
    .build();
  inner.sign(innerSource);
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feeSource.publicKey(),
    "200",
    inner,
    Networks.TESTNET,
  );
  feeBump.sign(feeSource);
  return feeBump.toEnvelope().toXDR("base64");
}

describe("parseSignedXdr / getEnvelopeSourceAccount", () => {
  it("parses a signed envelope and returns its source account", () => {
    const source = Keypair.random();
    const xdr = buildSignedXdr(source);
    const parsed = parseSignedXdr(xdr);
    expect(getEnvelopeSourceAccount(parsed)).toBe(source.publicKey());
  });

  it("returns the inner transaction source for a fee-bump envelope", () => {
    const feeSource = Keypair.random();
    const innerSource = Keypair.random();
    const xdr = buildFeeBumpXdr(feeSource, innerSource);
    const parsed = parseSignedXdr(xdr);
    expect(getEnvelopeSourceAccount(parsed)).toBe(innerSource.publicKey());
  });

  it("throws on malformed XDR", () => {
    expect(() => parseSignedXdr("not-xdr")).toThrow();
  });
});

describe("SubmissionService.submitXdrToNetwork", () => {
  const OLD_SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL;
  const OLD_STELLAR_RPC_URL = process.env.STELLAR_RPC_URL;

  beforeEach(() => {
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.STELLAR_RPC_URL;
  });

  afterEach(() => {
    if (OLD_SOROBAN_RPC_URL !== undefined) {
      process.env.SOROBAN_RPC_URL = OLD_SOROBAN_RPC_URL;
    }
    if (OLD_STELLAR_RPC_URL !== undefined) {
      process.env.STELLAR_RPC_URL = OLD_STELLAR_RPC_URL;
    }
  });

  function makeService(
    sendTransaction: jest.Mock,
    sleepDelays: number[] = [],
  ) {
    const sleep = jest.fn(async (ms: number) => {
      sleepDelays.push(ms);
    });
    const service = new SubmissionService({
      server: { sendTransaction } as any,
      sleep,
    });
    return { service, sleep };
  }

  it("returns the hash with status pending when the network accepts the envelope", async () => {
    const xdr = buildSignedXdr(Keypair.random());
    const sendTransaction = jest.fn().mockResolvedValue({
      status: "PENDING",
      hash: "abc123",
      latestLedger: 1,
      latestLedgerCloseTime: 1,
    });
    const { service } = makeService(sendTransaction);

    const result = await service.submitXdrToNetwork(xdr);

    expect(result).toEqual({ hash: "abc123", status: "pending", attempts: 1 });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("treats DUPLICATE as an accepted pending submission without retrying", async () => {
    const xdr = buildSignedXdr(Keypair.random());
    const sendTransaction = jest.fn().mockResolvedValue({
      status: "DUPLICATE",
      hash: "dup-hash",
      latestLedger: 1,
      latestLedgerCloseTime: 1,
    });
    const { service } = makeService(sendTransaction);

    const result = await service.submitXdrToNetwork(xdr);

    expect(result).toEqual({
      hash: "dup-hash",
      status: "pending",
      attempts: 1,
    });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("retries with exponential backoff when the RPC node asks to try again later", async () => {
    const xdr = buildSignedXdr(Keypair.random());
    const sendTransaction = jest
      .fn()
      .mockResolvedValueOnce({
        status: "TRY_AGAIN_LATER",
        hash: "",
        latestLedger: 1,
        latestLedgerCloseTime: 1,
      })
      .mockResolvedValue({
        status: "PENDING",
        hash: "late-hash",
        latestLedger: 2,
        latestLedgerCloseTime: 2,
      });
    const delays: number[] = [];
    const { service } = makeService(sendTransaction, delays);

    const result = await service.submitXdrToNetwork(xdr);

    expect(result).toEqual({
      hash: "late-hash",
      status: "pending",
      attempts: 2,
    });
    expect(sendTransaction).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([500]);
  });

  it("retries transient transport errors and succeeds on a later attempt", async () => {
    const xdr = buildSignedXdr(Keypair.random());
    const sendTransaction = jest
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue({
        status: "PENDING",
        hash: "retry-hash",
        latestLedger: 3,
        latestLedgerCloseTime: 3,
      });
    const delays: number[] = [];
    const { service } = makeService(sendTransaction, delays);

    const result = await service.submitXdrToNetwork(xdr);

    expect(result.attempts).toBe(3);
    expect(result.hash).toBe("retry-hash");
    expect(delays).toEqual([500, 1000]);
  });

  it("gives up after 5 attempts and throws a SubmissionError", async () => {
    const xdr = buildSignedXdr(Keypair.random());
    const sendTransaction = jest
      .fn()
      .mockRejectedValue(new Error("fetch failed"));
    const delays: number[] = [];
    const { service } = makeService(sendTransaction, delays);

    await expect(service.submitXdrToNetwork(xdr)).rejects.toThrow(
      SubmissionError,
    );
    expect(sendTransaction).toHaveBeenCalledTimes(5);
    // Backoff doubles after each failed attempt: 500, 1000, 2000, 4000.
    expect(delays).toEqual([500, 1000, 2000, 4000]);
  });

  it("does not retry when the network rejects the envelope", async () => {
    const xdr = buildSignedXdr(Keypair.random());
    const sendTransaction = jest.fn().mockResolvedValue({
      status: "ERROR",
      hash: "err-hash",
      latestLedger: 1,
      latestLedgerCloseTime: 1,
    });
    const delays: number[] = [];
    const { service, sleep } = makeService(sendTransaction, delays);

    await expect(service.submitXdrToNetwork(xdr)).rejects.toThrow(
      SubmissionError,
    );
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws when no RPC URL is configured and no server is injected", async () => {
    const xdr = buildSignedXdr(Keypair.random());
    const service = new SubmissionService();

    await expect(service.submitXdrToNetwork(xdr)).rejects.toThrow(
      /SOROBAN_RPC_URL or STELLAR_RPC_URL/,
    );
  });
});
