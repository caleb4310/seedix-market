-- The pool pair is always WHYPE. `backing` is the Keep/Kickback token, null for Burn.
ALTER TABLE coins ADD COLUMN IF NOT EXISTS backing bytea;
