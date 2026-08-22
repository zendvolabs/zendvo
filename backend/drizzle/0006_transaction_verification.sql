ALTER TABLE "transactions" ADD COLUMN "blockchain_tx_hash" text;--> statement-breakpoint
CREATE INDEX "tx_blockchain_tx_hash_idx" ON "transactions" USING btree ("blockchain_tx_hash");
