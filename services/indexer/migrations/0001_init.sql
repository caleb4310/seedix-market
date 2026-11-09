-- Seedix indexer schema. Applied to the existing host Postgres database `launchpad`.
-- No Postgres container. The role `launchpad` is the only login this database needs.

CREATE TABLE IF NOT EXISTS coins (
  pool_id        bytea PRIMARY KEY,
  chain_id       integer NOT NULL,
  coin           bytea NOT NULL,
  pair           bytea NOT NULL,
  name           text NOT NULL,
  symbol         text NOT NULL,
  mode           smallint NOT NULL,
  is_platform    boolean NOT NULL DEFAULT false,
  fee_recipient  bytea NOT NULL,
  team_wallet    bytea,
  team_amount    numeric(78, 0) NOT NULL DEFAULT 0,
  start_mcap     numeric(78, 0) NOT NULL,
  launch_time    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swaps (
  id           bigserial PRIMARY KEY,
  chain_id     integer NOT NULL,
  pool_id      bytea NOT NULL REFERENCES coins (pool_id),
  tx_hash      bytea NOT NULL,
  log_index    integer NOT NULL,
  sender       bytea NOT NULL,
  zero_for_one boolean NOT NULL,
  amount_in    numeric(78, 0) NOT NULL,
  amount_out   numeric(78, 0) NOT NULL,
  sqrt_price_x96 numeric(78, 0) NOT NULL,
  block_time   timestamptz NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS fees (
  id            bigserial PRIMARY KEY,
  chain_id      integer NOT NULL,
  pool_id       bytea NOT NULL,
  tx_hash       bytea NOT NULL,
  log_index     integer NOT NULL,
  pair_side     boolean NOT NULL,
  hook_fee_pips integer NOT NULL,
  hook_amt      numeric(78, 0) NOT NULL,
  platform_amt  numeric(78, 0) NOT NULL,
  block_time    timestamptz NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS claims (
  id         bigserial PRIMARY KEY,
  chain_id   integer NOT NULL,
  pool_id    bytea,
  pair       bytea,
  kind       text NOT NULL,
  to_address bytea NOT NULL,
  amount     numeric(78, 0) NOT NULL,
  tx_hash    bytea NOT NULL,
  block_time timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS kickback_epochs (
  chain_id       integer NOT NULL,
  pool_id        bytea NOT NULL,
  epoch          bigint NOT NULL,
  start_time     timestamptz NOT NULL,
  end_time       timestamptz NOT NULL,
  funded         numeric(78, 0) NOT NULL,
  root           bytea,
  manifest_hash  bytea,
  posted_at      timestamptz,
  cancelled      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (chain_id, pool_id, epoch)
);

CREATE INDEX IF NOT EXISTS swaps_pool_time_idx ON swaps (pool_id, block_time DESC);
CREATE INDEX IF NOT EXISTS fees_pool_time_idx ON fees (pool_id, block_time DESC);
