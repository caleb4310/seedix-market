-- Which launcher created the coin. Rows from a retired deployment are removed by services/indexer/src/retire.ts.

ALTER TABLE coins ADD COLUMN IF NOT EXISTS launcher bytea;
