import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { transactions } from "../../src/lib/db/schema";

describe("transactions schema", () => {
  it("stores and indexes the on-chain transaction hash", () => {
    const config = getTableConfig(transactions);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(columns.blockchain_tx_hash).toBeDefined();
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "tx_blockchain_tx_hash_idx",
    );
  });

  it("adds the blockchain hash through a migration", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../drizzle/0006_transaction_verification.sql"),
      "utf8",
    );

    expect(migration).toContain(
      'ALTER TABLE "transactions" ADD COLUMN "blockchain_tx_hash" text',
    );
    expect(migration).toContain('CREATE INDEX "tx_blockchain_tx_hash_idx"');
  });
});
