import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Account,
  Horizon
} from "@stellar/stellar-sdk";

export class TransactionBuilderService {
  private static horizonUrl = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
  private static server = new Horizon.Server(TransactionBuilderService.horizonUrl);
  
  private static sponsorAccount: Account | null = null;
  private static isFetching = false;
  private static mutexQueue: Array<() => void> = [];

  private static async lock(): Promise<void> {
    if (!this.isFetching) {
      this.isFetching = true;
      return Promise.resolve();
    }
    return new Promise(resolve => {
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

  static async buildCreateAccountXdr(targetAddress: string): Promise<string> {
    const sponsorSecret = process.env.STELLAR_SPONSOR_SECRET;
    if (!sponsorSecret) {
      throw new Error("STELLAR_SPONSOR_SECRET is not configured");
    }

    const sponsorKeypair = Keypair.fromSecret(sponsorSecret);
    const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

    await this.lock();
    try {
      if (!this.sponsorAccount) {
        const acc = await this.server.loadAccount(sponsorKeypair.publicKey());
        this.sponsorAccount = new Account(acc.accountId(), acc.sequenceNumber());
      }
      
      const tx = new TransactionBuilder(this.sponsorAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(
          Operation.createAccount({
            destination: targetAddress,
            startingBalance: "1.5",
          })
        )
        .setTimeout(30)
        .build();

      tx.sign(sponsorKeypair);
      return tx.toXDR();
    } catch (error) {
      this.sponsorAccount = null; // Reset cache on error so next time it fetches fresh
      throw error;
    } finally {
      this.unlock();
    }
  }
}
