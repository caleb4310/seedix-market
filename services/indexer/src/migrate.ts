import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "./store.ts";

export async function migrate(db: Queryable): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const dir = fileURLToPath(new URL("../migrations", import.meta.url));
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const seen = await db.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [file]);
    if ((seen.rowCount ?? seen.rows.length) > 0) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await db.query(sql);
    await db.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
  }
}
