-- Buybacks, holder balances, and Kickback payouts. Applied to the host `launchpad` database.

CREATE TABLE IF NOT EXISTS indexer_cursor (
  chain_id   integer PRIMARY KEY,
  last_block bigint NOT NULL
);

ALTER TABLE coins ADD COLUMN IF NOT EXISTS coin_is_token0 boolean NOT NULL DEFAULT false;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS coin_decimals integer NOT NULL DEFAULT 18;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS pair_decimals integer NOT NULL DEFAULT 18;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS pair_symbol text NOT NULL DEFAULT '';

ALTER TABLE swaps ADD COLUMN IF NOT EXISTS price numeric NOT NULL DEFAULT 0;
ALTER TABLE swaps ADD COLUMN IF NOT EXISTS block_number bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS buybacks (
  id          bigserial PRIMARY KEY,
  chain_id    integer NOT NULL,
  pool_id     bytea NOT NULL,
  tx_hash     bytea NOT NULL,
  log_index   integer NOT NULL,
  amount_in   numeric(78, 0) NOT NULL,
  coin_burned numeric(78, 0) NOT NULL,
  block_time  timestamptz NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS holders (
  chain_id integer NOT NULL,
  pool_id  bytea NOT NULL,
  account  bytea NOT NULL,
  balance  numeric(78, 0) NOT NULL,
  PRIMARY KEY (chain_id, pool_id, account)
);

CREATE TABLE IF NOT EXISTS transfers (
  chain_id     integer NOT NULL,
  tx_hash      bytea NOT NULL,
  log_index    integer NOT NULL,
  pool_id      bytea NOT NULL,
  from_address bytea NOT NULL,
  to_address   bytea NOT NULL,
  amount       numeric(78, 0) NOT NULL,
  block_time   timestamptz NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS kickback_payouts (
  id         bigserial PRIMARY KEY,
  chain_id   integer NOT NULL,
  pool_id    bytea NOT NULL,
  epoch      bigint NOT NULL,
  kind       text NOT NULL,
  account    bytea NOT NULL,
  amount     numeric(78, 0) NOT NULL,
  tx_hash    bytea NOT NULL,
  log_index  integer NOT NULL,
  block_time timestamptz NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS holders_account_idx ON holders (chain_id, account);
CREATE INDEX IF NOT EXISTS buybacks_time_idx ON buybacks (block_time DESC);
CREATE INDEX IF NOT EXISTS payouts_pool_time_idx ON kickback_payouts (pool_id, block_time DESC);
CREATE INDEX IF NOT EXISTS payouts_account_idx ON kickback_payouts (chain_id, account, block_time DESC);
