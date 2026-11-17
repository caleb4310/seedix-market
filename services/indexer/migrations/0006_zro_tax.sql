-- Creator ZRO tax and the Seedix protocol-fee mode. Default mode is ON_TOP (1).

ALTER TABLE coins
  ADD COLUMN IF NOT EXISTS creator_tax_bps integer,
  ADD COLUMN IF NOT EXISTS zro_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS zro_policy (
  chain_id integer PRIMARY KEY,
  fee_mode smallint NOT NULL DEFAULT 1,
  protocol_fee_bps integer NOT NULL DEFAULT 100
);
