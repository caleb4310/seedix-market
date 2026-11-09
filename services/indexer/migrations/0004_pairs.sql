-- Pair registry and optional coin metadata. Invalid social fields stay null.

CREATE TABLE IF NOT EXISTS pairs (
  chain_id integer NOT NULL,
  address bytea NOT NULL,
  status smallint NOT NULL,
  category smallint NOT NULL,
  PRIMARY KEY (chain_id, address)
);

ALTER TABLE coins ADD COLUMN IF NOT EXISTS category smallint NOT NULL DEFAULT 0;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS pair_status smallint NOT NULL DEFAULT 0;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS x_url text;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS telegram text;

CREATE INDEX IF NOT EXISTS pairs_category ON pairs (chain_id, category);
