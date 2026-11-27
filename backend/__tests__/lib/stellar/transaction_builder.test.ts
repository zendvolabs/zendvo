import { Keypair, Networks, Operation, TransactionBuilder, Account } from "@stellar/stellar-sdk";
import {
  ActivationError,
  TransactionBuilderService,
} from "../../../src/lib/stellar/transaction_builder";

const funder = Keypair.random();
const target = Keypair.random().publicKey();

function makeServer(opts: { targetExists?: boolean; targetError?: unknown } = {}) {
  return {
    loadAccount: jest.fn(async (id: string) => {
      if (id === target) {
        if (opts.targetError) throw opts.targetError;
        if (opts.targetExists) return new Account(target, "1");
        throw { response: { status: 404 } };
      }
      return new Account(funder.publicKey(), "100");
    }),
  } as any;
}

const env = (extra: Record<string, string> = {}) =>
  ({ STELLAR_SPONSOR_SECRET: funder.secret(), ...extra }) as NodeJS.ProcessEnv;

describe("TransactionBuilderService.buildCreateAccount", () => {
  it("builds an unsigned CreateAccount envelope", async () => {
    const svc = new TransactionBuilderService({ env: env(), horizonServer: makeServer() });
    const result = await svc.buildCreateAccount({ destination: target });

    const tx = TransactionBuilder.fromXDR(result.envelopeXdr, Networks.TESTNET) as any;
    expect(tx.signatures).toHaveLength(0);
    expect(tx.source).toBe(funder.publicKey());
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0].type).toBe("createAccount");
    expect(tx.operations[0].destination).toBe(target);
    expect(tx.operations[0].startingBalance).toBe("1.0000000");
    expect(result.startingBalance).toBe("1");
  });

  it("honours a configured starting balance", async () => {
    const svc = new TransactionBuilderService({
      env: env({ STELLAR_ACTIVATION_STARTING_BALANCE: "2.5" }),
      horizonServer: makeServer(),
    });
    const result = await svc.buildCreateAccount({ destination: target });
    expect(result.startingBalance).toBe("2.5");
  });

  it("uses the configured network passphrase", async () => {
    const svc = new TransactionBuilderService({
      env: env({ STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC }),
      horizonServer: makeServer(),
    });
    const result = await svc.buildCreateAccount({ destination: target });
    expect(result.networkPassphrase).toBe(Networks.PUBLIC);
  });

  it.each(["", "not-a-key", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"])(
    "rejects invalid address %p with 400",
    async (bad) => {
      const svc = new TransactionBuilderService({ env: env(), horizonServer: makeServer() });
      await expect(svc.buildCreateAccount({ destination: bad })).rejects.toMatchObject({
        code: "INVALID_STELLAR_ADDRESS",
        status: 400,
      });
    },
  );

  it("rejects a contract id as destination", async () => {
    const svc = new TransactionBuilderService({ env: env(), horizonServer: makeServer() });
    await expect(
      svc.buildCreateAccount({
        destination: "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STELLAR_ADDRESS" });
  });

  it("rejects a bad starting balance with 400", async () => {
    const svc = new TransactionBuilderService({ env: env(), horizonServer: makeServer() });
    await expect(
      svc.buildCreateAccount({ destination: target, startingBalance: "-1" }),
    ).rejects.toMatchObject({ code: "INVALID_STARTING_BALANCE", status: 400 });
  });

  it("returns 409 when the account already exists", async () => {
    const svc = new TransactionBuilderService({
      env: env(),
      horizonServer: makeServer({ targetExists: true }),
    });
    await expect(svc.buildCreateAccount({ destination: target })).rejects.toMatchObject({
      code: "ACCOUNT_ALREADY_ACTIVE",
      status: 409,
    });
  });

  it("returns 502 when Horizon fails for another reason", async () => {
    const svc = new TransactionBuilderService({
      env: env(),
      horizonServer: makeServer({ targetError: { response: { status: 503 } } }),
    });
    await expect(svc.buildCreateAccount({ destination: target })).rejects.toMatchObject({
      code: "HORIZON_UNAVAILABLE",
      status: 502,
    });
  });

  it("fails with a configuration error when the funding secret is missing", async () => {
    const svc = new TransactionBuilderService({ env: {} as NodeJS.ProcessEnv, horizonServer: makeServer() });
    await expect(svc.buildCreateAccount({ destination: target })).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
      status: 500,
    });
  });

  it("does not leak an invalid secret in the error", async () => {
    const svc = new TransactionBuilderService({
      env: { STELLAR_SPONSOR_SECRET: "SBADSECRET" } as NodeJS.ProcessEnv,
      horizonServer: makeServer(),
    });
    const err = await svc.buildCreateAccount({ destination: target }).catch((e) => e);
    expect(err).toBeInstanceOf(ActivationError);
    expect(err.message).not.toContain("SBADSECRET");
  });
});
