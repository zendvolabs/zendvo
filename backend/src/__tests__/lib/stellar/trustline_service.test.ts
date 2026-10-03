import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Account,
  Networks,
} from "@stellar/stellar-sdk";

const SPONSOR_SECRET = Keypair.random().secret();
const SPONSOR_PUBLIC = Keypair.fromSecret(SPONSOR_SECRET).publicKey();
const USER_ADDRESS = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();

const loadAccountMock = jest.fn();
const serverConstructorMock = jest.fn();

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation((url: string) => {
        serverConstructorMock(url);
        return { loadAccount: loadAccountMock };
      }),
    },
  };
});

describe("TrustlineService.buildSponsoredUsdcTrustlineXdr", () => {
  let TrustlineService: typeof import("@/lib/stellar/trustline_service").TrustlineService;

  beforeAll(() => {
    process.env.STELLAR_SPONSOR_SECRET = SPONSOR_SECRET;
    process.env.STELLAR_USDC_ISSUER = USDC_ISSUER;
    process.env.STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    process.env.STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org";

    jest.isolateModules(() => {
      TrustlineService = require("@/lib/stellar/trustline_service").TrustlineService;
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (TrustlineService as any).sponsorAccount = null;
    loadAccountMock.mockResolvedValue({
      accountId: () => SPONSOR_PUBLIC,
      sequenceNumber: () => "1234567890",
    });
  });

  it("throws when STELLAR_SPONSOR_SECRET is not configured", async () => {
    const original = process.env.STELLAR_SPONSOR_SECRET;
    delete process.env.STELLAR_SPONSOR_SECRET;

    await expect(
      TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS),
    ).rejects.toThrow("STELLAR_SPONSOR_SECRET is not configured");

    process.env.STELLAR_SPONSOR_SECRET = original;
  });

  it("throws when STELLAR_USDC_ISSUER is not configured", async () => {
    const original = process.env.STELLAR_USDC_ISSUER;
    delete process.env.STELLAR_USDC_ISSUER;

    await expect(
      TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS),
    ).rejects.toThrow("STELLAR_USDC_ISSUER is not configured");

    process.env.STELLAR_USDC_ISSUER = original;
  });

  it("returns a valid base64 XDR string", async () => {
    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);

    expect(typeof xdr).toBe("string");
    expect(xdr.length).toBeGreaterThan(0);
    expect(() => TransactionBuilder.fromXDR(xdr, Networks.TESTNET)).not.toThrow();
  });

  it("builds a transaction with exactly 3 operations in the correct order", async () => {
    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as any;

    expect(tx.operations).toHaveLength(3);
    expect(tx.operations[0].type).toBe("beginSponsoringFutureReserves");
    expect(tx.operations[1].type).toBe("changeTrust");
    expect(tx.operations[2].type).toBe("endSponsoringFutureReserves");
  });

  it("sponsors the correct user address in beginSponsoringFutureReserves", async () => {
    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as any;

    const beginOp = tx.operations[0];
    expect(beginOp.sponsoredId).toBe(USER_ADDRESS);
  });

  it("adds a changeTrust operation for the USDC asset from the correct issuer", async () => {
    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as any;

    const changeTrustOp = tx.operations[1];
    expect(changeTrustOp.line.code).toBe("USDC");
    expect(changeTrustOp.line.issuer).toBe(USDC_ISSUER);
  });

  it("sets the transaction source to the sponsor public key", async () => {
    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as any;

    expect(tx.source).toBe(SPONSOR_PUBLIC);
  });

  it("sets the sponsor as source of the beginSponsoringFutureReserves operation", async () => {
    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as any;

    const beginOp = tx.operations[0];
    expect(beginOp.source).toBe(SPONSOR_PUBLIC);
  });

  it("sets the user as source of the changeTrust and endSponsoringFutureReserves operations", async () => {
    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as any;

    expect(tx.operations[1].source).toBe(USER_ADDRESS);
    expect(tx.operations[2].source).toBe(USER_ADDRESS);
  });

  it("signs the transaction with the sponsor keypair", async () => {
    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as any;

    expect(tx.signatures).toHaveLength(1);
    const sponsorKp = Keypair.fromSecret(SPONSOR_SECRET);
    expect(tx.signatures[0].hint().toString("hex")).toBe(
      sponsorKp.signatureHint().toString("hex"),
    );
  });

  it("sets a 30-second timeout on the transaction", async () => {
    const xdr = await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as any;

    const now = Math.floor(Date.now() / 1000);
    expect(tx.timeBounds.maxTime).toBeGreaterThanOrEqual(now + 25);
    expect(tx.timeBounds.maxTime).toBeLessThanOrEqual(now + 35);
  });

  it("caches the sponsor account across calls (single Horizon loadAccount)", async () => {
    await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);
    await TrustlineService.buildSponsoredUsdcTrustlineXdr(USER_ADDRESS);

    expect(loadAccountMock).toHaveBeenCalledTimes(1);
  });
});
