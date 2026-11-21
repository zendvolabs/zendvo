-- Migration: index gifts_metadata for off-chain gift metadata lookups.
-- The gifts_metadata table stores off-chain metadata (message, image, privacy
-- flags) keyed by the on-chain (Soroban) gift ID. These indexes support the
-- /api/gifts/metadata indexing endpoint and its conflict-safe upserts.

CREATE UNIQUE INDEX IF NOT EXISTS gifts_metadata_contract_gift_id_unique
  ON gifts_metadata (contract_gift_id);

CREATE INDEX IF NOT EXISTS gifts_metadata_user_id_idx
  ON gifts_metadata (user_id);
