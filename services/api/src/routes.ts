import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { elysiumTestnet, cleanSocials } from "@seedix/shared";
import { bucketSeconds, candles, type ChartPoint } from "./chart.ts";

export type Db = {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

const POOL = /^[0-9a-fA-F]{64}$/;
const ADDR = /^[0-9a-fA-F]{40}$/;

function hexParam(value: string): Buffer {
  return Buffer.from(value, "hex");
}

function prefixed(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.startsWith("0x") ? value : `0x${value}`;
}

function modeName(mode: number): "keep" | "kickback" | "burn" {
  if (mode === 1) return "kickback";
  if (mode === 2) return "burn";
  return "keep";
}

async function tokenList(db: Db, chainId: number, filePath?: string): Promise<{ tokens: unknown[] }> {
  const overlayPath = filePath ?? fileURLToPath(new URL("../token-list.json", import.meta.url));
  let overlay: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(readFileSync(overlayPath, "utf8")) as { tokens?: Array<Record<string, unknown>> };
    overlay = parsed.tokens ?? [];
  } catch {
    overlay = [];
  }
  const res = await db.query<{ address: string; status: number; category: number }>(
    `SELECT encode(address, 'hex') AS address, status, category FROM pairs WHERE chain_id = $1`,
    [chainId],
  );
  const byAddress = new Map<string, Record<string, unknown>>();
  for (const row of res.rows) {
    const address = prefixed(row.address).toLowerCase();
    byAddress.set(address, {
      address: prefixed(row.address),
      status: Number(row.status),
      category: categoryName(Number(row.category)),
      logo: null,
    });
  }
  for (const token of overlay) {
    const address = typeof token.address === "string" ? token.address.toLowerCase() : "";
    if (!/^0x[0-9a-f]{40}$/.test(address)) continue;
    const current = byAddress.get(address) ?? { address: token.address, status: 0, category: "crypto", logo: null };
    byAddress.set(address, {
      ...current,
      symbol: typeof token.symbol === "string" ? token.symbol : null,
      name: typeof token.name === "string" ? token.name : null,
      logo: typeof token.logo === "string" ? token.logo : null,
    });
  }
  return { tokens: [...byAddress.values()] };
}

function limitOf(query: URLSearchParams): number {
  const raw = Number(query.get("limit") ?? 100);
  if (!Number.isInteger(raw) || raw < 1) return 100;
  return Math.min(raw, 500);
}

type CoinRow = {
  pool_id: string;
  coin: string;
  pair: string;
  name: string;
  symbol: string;
  pair_symbol: string;
  mode: number;
  is_platform: boolean;
  fee_recipient: string;
  team_wallet: string | null;
  launch_time: string | number;
  price: string | null;
  holders: string | number;
  start_mcap: string;
  category?: number | string;
  pair_decimals?: number | string;
  pair_status?: number | string;
  description?: string | null;
  website?: string | null;
  x_url?: string | null;
  telegram?: string | null;
};

const CATEGORY = ["crypto", "stock", "preipo"] as const;

function categoryName(value: number): (typeof CATEGORY)[number] {
  return CATEGORY[value] ?? "crypto";
}

function coinJson(row: CoinRow) {
  return {
    poolId: prefixed(row.pool_id),
    coin: prefixed(row.coin),
    pair: prefixed(row.pair),
    name: row.name,
    symbol: row.symbol,
    pairSymbol: row.pair_symbol,
    mode: modeName(Number(row.mode)),
    isPlatform: row.is_platform,
    feeRecipient: prefixed(row.fee_recipient),
    teamWallet: prefixed(row.team_wallet),
    launchTime: Number(row.launch_time),
    price: row.price,
    holders: Number(row.holders),
    startMcap: row.start_mcap,
    category: categoryName(Number(row.category ?? 0)),
    pairDecimals: Number(row.pair_decimals ?? 18),
    pairStatus: Number(row.pair_status ?? 0),
    description: row.description ?? null,
    website: row.website ?? null,
    x: row.x_url ?? null,
    telegram: row.telegram ?? null,
  };
}

const coinSelect = `SELECT encode(c.pool_id, 'hex') AS pool_id, encode(c.coin, 'hex') AS coin, encode(c.pair, 'hex') AS pair,
  c.name, c.symbol, c.pair_symbol, c.mode, c.is_platform, c.category, c.pair_decimals, c.pair_status,
  c.description, c.website, c.x_url, c.telegram, encode(c.fee_recipient, 'hex') AS fee_recipient,
  encode(c.team_wallet, 'hex') AS team_wallet, extract(epoch from c.launch_time) AS launch_time, c.start_mcap::text AS start_mcap,
  (SELECT s.price::text FROM swaps s WHERE s.pool_id = c.pool_id ORDER BY s.block_time DESC, s.log_index DESC LIMIT 1) AS price,
  (SELECT count(*) FROM holders h WHERE h.pool_id = c.pool_id AND h.balance > 0) AS holders
  FROM coins c`;

export type RequestExtras = {
  body?: unknown;
  inspect?: (address: string) => Promise<Record<string, unknown> | null>;
  tokenListPath?: string;
};

export async function handleRequest(
  db: Db,
  method: string,
  pathname: string,
  query: URLSearchParams,
  extras: RequestExtras = {},
): Promise<{ status: number; json: unknown }> {
  const path = pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  if (method === "POST" && path === "/metadata") {
    const record = extras.body && typeof extras.body === "object" ? (extras.body as Record<string, unknown>) : {};
    return { status: 200, json: cleanSocials(record) };
  }
  if (method !== "GET") return { status: 405, json: { error: "GET only" } };
  const chainId = elysiumTestnet.id;
  if (path === "/health") return { status: 200, json: { ok: true, chainId } };
  if (path === "/coins") {
    const filters = ["c.chain_id = $1"];
    const params: unknown[] = [chainId];
    const mode = query.get("mode");
    const category = query.get("category");
    if (category === "crypto" || category === "stock" || category === "preipo") {
      params.push(category === "stock" ? 1 : category === "preipo" ? 2 : 0);
      filters.push(`c.category = $${params.length}`);
    }
    if (mode === "keep" || mode === "kickback" || mode === "burn") {
      params.push(mode === "kickback" ? 1 : mode === "burn" ? 2 : 0);
      filters.push(`c.mode = $${params.length}`);
    }
    const q = query.get("q");
    if (q && q.length > 0 && q.length <= 32) {
      params.push(`%${q.replace(/[%_]/g, "")}%`);
      filters.push(`(c.symbol ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    const sort = query.get("sort");
    const order = sort === "holders" ? "holders DESC" : sort === "mcap" ? "c.start_mcap DESC" : "c.launch_time DESC";
    params.push(limitOf(query));
    const res = await db.query<CoinRow>(
      `${coinSelect} WHERE ${filters.join(" AND ")} ORDER BY ${order} LIMIT $${params.length}`,
      params,
    );
    return { status: 200, json: { coins: res.rows.map(coinJson) } };
  }
  if (path === "/pairs") {
    const filters = ["chain_id = $1"];
    const params: unknown[] = [chainId];
    const category = query.get("category");
    if (category === "crypto" || category === "stock" || category === "preipo") {
      params.push(category === "stock" ? 1 : category === "preipo" ? 2 : 0);
      filters.push(`category = $${params.length}`);
    }
    const res = await db.query<{ address: string; status: number; category: number }>(
      `SELECT encode(address, 'hex') AS address, status, category FROM pairs WHERE ${filters.join(" AND ")} ORDER BY address`,
      params,
    );
    return {
      status: 200,
      json: {
        pairs: res.rows.map((row) => ({
          address: prefixed(row.address),
          status: Number(row.status),
          category: categoryName(Number(row.category)),
        })),
      },
    };
  }
  if (path === "/pairs/inspect") {
    const address = query.get("address") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { status: 400, json: { error: "bad address" } };
    if (!extras.inspect) return { status: 503, json: { error: "chain unavailable" } };
    const info = await extras.inspect(address);
    if (!info) return { status: 400, json: { error: "unreadable" } };
    return { status: 200, json: info };
  }
  if (path === "/tokenlist") {
    return { status: 200, json: await tokenList(db, chainId, extras.tokenListPath) };
  }
  if (path === "/buybacks") {
    const res = await db.query(
      `SELECT encode(pool_id, 'hex') AS pool_id, encode(tx_hash, 'hex') AS tx_hash, log_index,
              amount_in::text AS amount_in, coin_burned::text AS coin_burned, extract(epoch from block_time) AS block_time
       FROM buybacks WHERE chain_id = $1 ORDER BY block_time DESC LIMIT $2`,
      [chainId, limitOf(query)],
    );
    return {
      status: 200,
      json: {
        buybacks: res.rows.map((row) => ({
          poolId: prefixed(String(row.pool_id)),
          txHash: prefixed(String(row.tx_hash)),
          logIndex: Number(row.log_index),
          amountIn: String(row.amount_in),
          coinBurned: String(row.coin_burned),
          blockTime: Number(row.block_time),
        })),
      },
    };
  }
  const portfolio = path.match(/^\/portfolio\/(0x[0-9a-fA-F]{40})$/);
  if (portfolio?.[1]) {
    const account = portfolio[1].slice(2);
    if (!ADDR.test(account)) return { status: 400, json: { error: "bad address" } };
    const [balances, payouts, swaps] = await Promise.all([
      db.query(
        `SELECT encode(h.pool_id, 'hex') AS pool_id, c.symbol, c.name, h.balance::text AS balance
         FROM holders h JOIN coins c ON c.pool_id = h.pool_id
         WHERE h.chain_id = $1 AND h.account = $2 AND h.balance > 0`,
        [chainId, hexParam(account)],
      ),
      db.query(
        `SELECT encode(pool_id, 'hex') AS pool_id, epoch::text AS epoch, kind, amount::text AS amount,
                encode(tx_hash, 'hex') AS tx_hash, extract(epoch from block_time) AS block_time
         FROM kickback_payouts WHERE chain_id = $1 AND account = $2 ORDER BY block_time DESC LIMIT $3`,
        [chainId, hexParam(account), limitOf(query)],
      ),
      db.query(
        `SELECT encode(pool_id, 'hex') AS pool_id, encode(tx_hash, 'hex') AS tx_hash, zero_for_one,
                amount_in::text AS amount_in, amount_out::text AS amount_out, price::text AS price,
                extract(epoch from block_time) AS block_time
         FROM swaps WHERE chain_id = $1 AND sender = $2 ORDER BY block_time DESC LIMIT $3`,
        [chainId, hexParam(account), limitOf(query)],
      ),
    ]);
    return {
      status: 200,
      json: {
        balances: balances.rows.map((row) => ({
          poolId: prefixed(String(row.pool_id)),
          symbol: String(row.symbol),
          name: String(row.name),
          balance: String(row.balance),
        })),
        kickbacks: payouts.rows.map((row) => ({
          poolId: prefixed(String(row.pool_id)),
          epoch: String(row.epoch),
          kind: String(row.kind),
          amount: String(row.amount),
          txHash: prefixed(String(row.tx_hash)),
          blockTime: Number(row.block_time),
        })),
        swaps: swaps.rows.map((row) => ({
          poolId: prefixed(String(row.pool_id)),
          txHash: prefixed(String(row.tx_hash)),
          zeroForOne: Boolean(row.zero_for_one),
          amountIn: String(row.amount_in),
          amountOut: String(row.amount_out),
          price: String(row.price),
          blockTime: Number(row.block_time),
        })),
      },
    };
  }
  const coinPath = path.match(/^\/coins\/0x([0-9a-fA-F]{64})(\/chart|\/holders|\/swaps|\/kickbacks)?$/);
  if (!coinPath?.[1]) return { status: 404, json: { error: "not found" } };
  const id = coinPath[1];
  if (!POOL.test(id)) return { status: 400, json: { error: "bad pool" } };
  const pool = hexParam(id);
  const tail = coinPath[2] ?? "";
  if (tail === "") {
    const res = await db.query<CoinRow>(`${coinSelect} WHERE c.chain_id = $1 AND c.pool_id = $2`, [chainId, pool]);
    const row = res.rows[0];
    if (!row) return { status: 404, json: { error: "not found" } };
    return { status: 200, json: coinJson(row) };
  }
  if (tail === "/chart") {
    const bucket = bucketSeconds(query.get("bucket") ?? "5m");
    if (bucket === null) return { status: 400, json: { error: "bucket must be 5m, 1h, or 1d" } };
    const res = await db.query<{ t: string; price: string; volume: string }>(
      `SELECT t, price, volume FROM (
         SELECT extract(epoch from block_time) AS t, price::text AS price, amount_in::text AS volume
         FROM swaps WHERE chain_id = $1 AND pool_id = $2
         ORDER BY block_time DESC, log_index DESC LIMIT 5000
       ) recent ORDER BY t ASC`,
      [chainId, pool],
    );
    const points: ChartPoint[] = res.rows.map((row) => ({ t: Number(row.t), price: row.price, volume: BigInt(row.volume) }));
    return { status: 200, json: { bucket, candles: candles(points, bucket) } };
  }
  if (tail === "/holders") {
    const res = await db.query(
      `SELECT encode(account, 'hex') AS account, balance::text AS balance
       FROM holders WHERE chain_id = $1 AND pool_id = $2 AND balance > 0
       ORDER BY balance DESC LIMIT $3`,
      [chainId, pool, limitOf(query)],
    );
    return {
      status: 200,
      json: { holders: res.rows.map((row) => ({ account: prefixed(String(row.account)), balance: String(row.balance) })) },
    };
  }
  if (tail === "/swaps") {
    const res = await db.query(
      `SELECT encode(tx_hash, 'hex') AS tx_hash, encode(sender, 'hex') AS sender, zero_for_one,
              amount_in::text AS amount_in, amount_out::text AS amount_out, price::text AS price,
              extract(epoch from block_time) AS block_time
       FROM swaps WHERE chain_id = $1 AND pool_id = $2 ORDER BY block_time DESC LIMIT $3`,
      [chainId, pool, limitOf(query)],
    );
    return {
      status: 200,
      json: {
        swaps: res.rows.map((row) => ({
          txHash: prefixed(String(row.tx_hash)),
          sender: prefixed(String(row.sender)),
          zeroForOne: Boolean(row.zero_for_one),
          amountIn: String(row.amount_in),
          amountOut: String(row.amount_out),
          price: String(row.price),
          blockTime: Number(row.block_time),
        })),
      },
    };
  }
  const res = await db.query(
    `SELECT epoch::text AS epoch, kind, encode(account, 'hex') AS account, amount::text AS amount,
            encode(tx_hash, 'hex') AS tx_hash, extract(epoch from block_time) AS block_time
     FROM kickback_payouts WHERE chain_id = $1 AND pool_id = $2 ORDER BY block_time DESC LIMIT $3`,
    [chainId, pool, limitOf(query)],
  );
  const epochs = await db.query(
    `SELECT epoch::text AS epoch, funded::text AS funded, carry::text AS carry,
            sealed_amount::text AS sealed_amount, encode(root, 'hex') AS root, cancelled,
            extract(epoch from start_time) AS start_time, extract(epoch from end_time) AS end_time
     FROM kickback_epochs WHERE chain_id = $1 AND pool_id = $2 ORDER BY epoch DESC LIMIT $3`,
    [chainId, pool, limitOf(query)],
  );
  return {
    status: 200,
    json: {
      payouts: res.rows.map((row) => ({
        epoch: String(row.epoch),
        kind: String(row.kind),
        account: prefixed(String(row.account)),
        amount: String(row.amount),
        txHash: prefixed(String(row.tx_hash)),
        blockTime: Number(row.block_time),
      })),
      epochs: epochs.rows.map((row) => ({
        epoch: String(row.epoch),
        funded: String(row.funded),
        carry: row.carry == null ? "0" : String(row.carry),
        sealedAmount: row.sealed_amount == null ? null : String(row.sealed_amount),
        root: prefixed(row.root == null ? "" : String(row.root)),
        cancelled: Boolean(row.cancelled),
        start: Number(row.start_time),
        end: Number(row.end_time),
      })),
    },
  };
}
