import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

export type Keep = { chainId: number; launcher: string; startBlock: number; tokens: string[] };

const CHILD_TABLES = ["swaps", "fees", "claims", "kickback_epochs", "buybacks", "holders", "transfers", "kickback_payouts"] as const;

/** A coin leaves when its launcher is some other deployment, or when it predates the current start block and has no launcher recorded. */
export function retiredSql(): string {
  return `(launcher IS NOT NULL AND launcher <> $2) OR (launcher IS NULL AND launch_block < $3)`;
}

export function readKeep(json: {
  chainId?: number;
  startBlock?: number;
  contracts?: { launcher?: string };
  tokens?: Record<string, string>;
}): Keep {
  const launcher = json.contracts?.launcher ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(launcher)) throw new Error("deployment file has no launcher address");
  if (typeof json.chainId !== "number" || typeof json.startBlock !== "number") throw new Error("deployment file is missing chain id or start block");
  const tokens = Object.values(json.tokens ?? {})
    .filter((value) => /^0x[0-9a-fA-F]{40}$/.test(value))
    .map((value) => value.slice(2).toLowerCase());
  return { chainId: json.chainId, launcher, startBlock: json.startBlock, tokens };
}

/** Pairs left by a retired launcher: not the backing of a coin we keep, and not in the current deployment token list. */
export function stalePairSql(): string {
  return `NOT EXISTS (
       SELECT 1 FROM coins c
       WHERE c.chain_id = pairs.chain_id
         AND c.backing = pairs.address
         AND NOT (${retiredSql().replaceAll("launcher", "c.launcher").replaceAll("launch_block", "c.launch_block")})
     )
     AND NOT (lower(encode(pairs.address, 'hex')) = ANY($4::text[]))`;
}

function launcherBuffer(address: string): Buffer {
  return Buffer.from(address.slice(2), "hex");
}

export async function retireCoins(db: pg.Pool | pg.PoolClient, keep: Keep, apply: boolean): Promise<Record<string, number>> {
  const where = `chain_id = $1 AND (${retiredSql()})`;
  const params = [keep.chainId, launcherBuffer(keep.launcher), keep.startBlock];
  const counts: Record<string, number> = {};
  const doomed = `SELECT pool_id FROM coins WHERE ${where}`;
  for (const table of CHILD_TABLES) {
    const res = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE pool_id IN (${doomed})`, params);
    counts[table] = Number(res.rows[0]?.n ?? 0);
  }
  const coins = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM coins WHERE ${where}`, params);
  counts.coins = Number(coins.rows[0]?.n ?? 0);
  const pairParams = [...params, keep.tokens];
  const pairs = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pairs WHERE chain_id = $1 AND ${stalePairSql()}`,
    pairParams,
  );
  counts.pairs = Number(pairs.rows[0]?.n ?? 0);
  if (!apply) return counts;
  await db.query("BEGIN");
  try {
    for (const table of CHILD_TABLES) {
      await db.query(`DELETE FROM ${table} WHERE pool_id IN (${doomed})`, params);
    }
    await db.query(`DELETE FROM coins WHERE ${where}`, params);
    await db.query(`DELETE FROM pairs WHERE chain_id = $1 AND ${stalePairSql()}`, pairParams);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
  return counts;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const file = fileURLToPath(new URL("../../../deployments/99801.json", import.meta.url));
  const keep = readKeep(
    JSON.parse(readFileSync(file, "utf8")) as {
      chainId?: number;
      startBlock?: number;
      contracts?: { launcher?: string };
      tokens?: Record<string, string>;
    },
  );
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    console.log("retire: set DATABASE_URL to the host launchpad database");
    process.exitCode = 1;
    return;
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const counts = await retireCoins(pool, keep, apply);
    const line = Object.entries(counts)
      .map(([name, count]) => `${name}=${count}`)
      .join(" ");
    console.log(`${apply ? "deleted" : "dry-run"} launcher=${keep.launcher} start=${keep.startBlock} ${line}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "retire failed");
    process.exitCode = 1;
  });
}
