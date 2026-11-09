-- Block numbers so a reorg can drop a replaced range and rebuild holder balances.
-- Kickback rounds record the pulled amount, the rolled-in carry, and the sealed remainder.

ALTER TABLE coins ADD COLUMN IF NOT EXISTS launch_block bigint NOT NULL DEFAULT 0;
ALTER TABLE fees ADD COLUMN IF NOT EXISTS block_number bigint NOT NULL DEFAULT 0;
ALTER TABLE buybacks ADD COLUMN IF NOT EXISTS block_number bigint NOT NULL DEFAULT 0;
ALTER TABLE kickback_payouts ADD COLUMN IF NOT EXISTS block_number bigint NOT NULL DEFAULT 0;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS block_number bigint NOT NULL DEFAULT 0;

ALTER TABLE kickback_epochs ADD COLUMN IF NOT EXISTS pulled numeric(78, 0) NOT NULL DEFAULT 0;
ALTER TABLE kickback_epochs ADD COLUMN IF NOT EXISTS carry numeric(78, 0) NOT NULL DEFAULT 0;
ALTER TABLE kickback_epochs ADD COLUMN IF NOT EXISTS sealed_amount numeric(78, 0);
ALTER TABLE kickback_epochs ADD COLUMN IF NOT EXISTS fund_block bigint NOT NULL DEFAULT 0;
