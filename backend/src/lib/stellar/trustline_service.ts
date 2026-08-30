import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Account,
  Asset,
  Horizon,
} from "@stellar/stellar-sdk";

export class TrustlineService {
  private static horizonUrl =
    process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
  private static server = new Horizon.Server(TrustlineService.horizonUrl);

  private static sponsorAccount: Account | null = null;
  private static isFetching = false;
  private static mutexQueue: Array<() => void> = [];

  private static async lock(): Promise<void> {
    if (!this.isFetching) {
      this.isFetching = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.mutexQueue.push(resolve);
    });
  }

  private static unlock() {
    if (this.mutexQueue.length > 0) {
      const resolve = this.mutexQueue.shift();
      if (resolve) resolve();
    } else {
      this.isFetching = false;
    }
  }

  static async buildSponsoredUsdcTrustlineXdr(
    userAddress: string,
  ): Promise<string> {
    const sponsorSecret = process.env.STELLAR_SPONSOR_SECRET;
    if (!sponsorSecret) {
      throw new Error("STELLAR_SPONSOR_SECRET is not configured");
    }

    const usdcIssuer = process.env.STELLAR_USDC_ISSUER;
    if (!usdcIssuer) {
      throw new Error("STELLAR_USDC_ISSUER is not configured");
    }

    const sponsorKeypair = Keypair.fromSecret(sponsorSecret);
    const networkPassphrase =
      process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
    const usdcAsset = new Asset("USDC", usdcIssuer);

    await this.lock();
    try {
      if (!this.sponsorAccount) {
        const acc = await this.server.loadAccount(sponsorKeypair.publicKey());
        this.sponsorAccount = new Account(acc.accountId(), acc.sequenceNumber());
      }

      const tx = new TransactionBuilder(this.sponsorAccount, {
        fee: "300",
        networkPassphrase,
      })
        .addOperation(
          Operation.beginSponsoringFutureReserves({
            sponsoredId: userAddress,
            source: sponsorKeypair.publicKey(),
          }),
        )
        .addOperation(
          Operation.changeTrust({
            asset: usdcAsset,
            source: userAddress,
          }),
        )
        .addOperation(
          Operation.endSponsoringFutureReserves({
            source: userAddress,
          }),
        )
        .setTimeout(30)
        .build();

      tx.sign(sponsorKeypair);
      return tx.toXDR();
    } catch (error) {
      this.sponsorAccount = null;
      throw error;
    } finally {
      this.unlock();
    }
  }
}
