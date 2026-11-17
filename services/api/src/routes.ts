import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { elysiumTestnet, cleanSocials, LAUNCH_SUPPLY, marketCapFromSpot, reportedZroTax } from "@seedix/shared";
import { attachLogo, logoFor } from "./logos.ts";
import { peekNonce } from "./logoAuth.ts";
import { claimsForPool } from "./claims.ts";
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
    const address = prefixed(row.address);
    if (!address) continue;
    byAddress.set(address.toLowerCase(), {
      address,
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

function limitOf(query: URLSearchParams, ceiling = 500): number {
  const raw = Number(query.get("limit") ?? 100);
  if (!Number.isInteger(raw) || raw < 1) return Math.min(100, ceiling);
  return Math.min(raw, ceiling);
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
  coin_decimals?: number | string;
  coin_is_token0?: boolean;
  supply?: string;
  backing?: string | null;
  volume_24h?: string;
  pair_status?: number | string;
  description?: string | null;
  website?: string | null;
  x_url?: string | null;
  telegram?: string | null;
  creator_tax_bps?: number | string | null;
  zro_enabled?: boolean | null;
  zro_fee_mode?: number | string | null;
  protocol_fee_bps?: number | string | null;
};

const CATEGORY = ["crypto", "stock", "preipo"] as const;

function categoryName(value: number): (typeof CATEGORY)[number] {
  return CATEGORY[value] ?? "crypto";
}

type OverlayToken = { symbol?: string; name?: string; logo?: string | null; usd?: number };

function tokenOverlay(filePath?: string): Map<string, OverlayToken> {
  const map = new Map<string, OverlayToken>();
  const overlayPath = filePath ?? fileURLToPath(new URL("../token-list.json", import.meta.url));
  try {
    const parsed = JSON.parse(readFileSync(overlayPath, "utf8")) as {
      tokens?: Array<{ address?: string; usd?: number; symbol?: string; name?: string; logo?: string }>;
    };
    for (const token of parsed.tokens ?? []) {
      if (typeof token.address !== "string") continue;
      map.set(token.address.toLowerCase(), {
        symbol: typeof token.symbol === "string" ? token.symbol : undefined,
        name: typeof token.name === "string" ? token.name : undefined,
        logo: typeof token.logo === "string" ? token.logo : null,
        usd: typeof token.usd === "number" && Number.isFinite(token.usd) ? token.usd : undefined,
      });
    }
  } catch {
    return map;
  }
  return map;
}

function liveMarketCap(row: CoinRow): string | null {
  const pairDecimals = Number(row.pair_decimals ?? 18);
  const summed = row.supply && /^\d+$/.test(row.supply) ? BigInt(row.supply) : 0n;
  const supply = summed > 0n ? summed : LAUNCH_SUPPLY;
  if (!row.price || row.price === "0") return null;
  return marketCapFromSpot(row.price, supply, pairDecimals);
}

function coinJson(row: CoinRow, overlay: Map<string, OverlayToken>) {
  const pair = prefixed(row.pair);
  const backing = prefixed(row.backing);
  const extra = backing ? overlay.get(backing.toLowerCase()) : undefined;
  const backingSymbol = extra?.symbol && !/^whype$/i.test(extra.symbol) ? extra.symbol : null;
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
    marketCap: liveMarketCap(row),
    coinIsToken0: Boolean(row.coin_is_token0),
    backing: prefixed(row.backing),
    volume24h: row.volume_24h ?? "0",
    image: logoFor(prefixed(row.pool_id) ?? ""),
    backingSymbol,
    backingLogo: extra?.logo ?? null,
    pairUsd: pair ? (overlay.get(pair.toLowerCase())?.usd ?? null) : null,
    category: categoryName(Number(row.category ?? 0)),
    pairDecimals: Number(row.pair_decimals ?? 18),
    pairStatus: Number(row.pair_status ?? 0),
    description: row.description ?? null,
    website: row.website ?? null,
    x: row.x_url ?? null,
    telegram: row.telegram ?? null,
    zroTax: reportedZroTax({
      enabled: Boolean(row.zro_enabled),
      creatorTaxBps: Number(row.creator_tax_bps ?? 0),
      protocolFeeBps: Number(row.protocol_fee_bps ?? 100),
      feeMode: row.zro_fee_mode == null ? 1 : Number(row.zro_fee_mode),
    }),
  };
}

const coinSelect = `SELECT encode(c.pool_id, 'hex') AS pool_id, encode(c.coin, 'hex') AS coin, encode(c.pair, 'hex') AS pair,
  c.name, c.symbol, c.pair_symbol, c.mode, c.is_platform, c.category, c.coin_decimals, c.pair_decimals, c.coin_is_token0, c.pair_status,
  c.description, c.website, c.x_url, c.telegram, encode(c.fee_recipient, 'hex') AS fee_recipient,
  encode(c.team_wallet, 'hex') AS team_wallet, encode(c.backing, 'hex') AS backing, extract(epoch from c.launch_time) AS launch_time, c.start_mcap::text AS start_mcap,
  (SELECT s.price::text FROM swaps s WHERE s.pool_id = c.pool_id ORDER BY s.block_time DESC, s.log_index DESC LIMIT 1) AS price,
  (SELECT COALESCE(SUM(h.balance), 0)::text FROM holders h WHERE h.pool_id = c.pool_id) AS supply,
  (SELECT COALESCE(SUM(s.amount_in), 0)::text FROM swaps s WHERE s.pool_id = c.pool_id AND s.block_time > now() - interval '1 day' AND ((c.coin_is_token0 AND NOT s.zero_for_one) OR (NOT c.coin_is_token0 AND s.zero_for_one))) AS volume_24h,
  (SELECT count(*) FROM holders h WHERE h.pool_id = c.pool_id AND h.balance > 0) AS holders,
  COALESCE(c.creator_tax_bps, 0) AS creator_tax_bps, COALESCE(c.zro_enabled, false) AS zro_enabled,
  COALESCE(p.fee_mode, 1) AS zro_fee_mode, COALESCE(p.protocol_fee_bps, 100) AS protocol_fee_bps
  FROM coins c
  LEFT JOIN zro_policy p ON p.chain_id = c.chain_id`;

export type RequestExtras = {
  body?: unknown;
  inspect?: (address: string) => Promise<Record<string, unknown> | null>;
  tokenListPath?: string;
  authorizeAttach?: (input: {
    poolId: string;
    url: string;
    nonce: bigint;
    expiry: bigint;
    signature: string;
  }) => Promise<{ ok: true } | { ok: false; status: number; error: string }>;
};

let hypeCache: { at: number; usd: number | null } = { at: 0, usd: null };

/** CoinGecko `hyperliquid` id, cached for 60s. A failed refresh keeps the last price. */
export async function hypeQuote(): Promise<{ usd: number | null; source: string; stale: boolean }> {
  if (hypeCache.usd != null && Date.now() - hypeCache.at < 60_000) {
    return { usd: hypeCache.usd, source: "coingecko:hyperliquid", stale: false };
  }
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd");
    const body = (await response.json()) as { hyperliquid?: { usd?: number } };
    const usd = body.hyperliquid?.usd;
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
      hypeCache = { at: Date.now(), usd };
      return { usd, source: "coingecko:hyperliquid", stale: false };
    }
  } catch {
    /* stale fallback */
  }
  return { usd: hypeCache.usd, source: "coingecko:hyperliquid", stale: hypeCache.usd != null };
}

export async function handleRequest(
  db: Db,
  method: string,
  pathname: string,
  query: URLSearchParams,
  extras: RequestExtras = {},
): Promise<{ status: number; json: unknown }> {
  const path = pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  if (method === "GET" && path === "/logos/nonce") {
    const address = query.get("address") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { status: 400, json: { error: "bad address" } };
    return { status: 200, json: { nonce: peekNonce(address).toString() } };
  }
  if (method === "POST" && path === "/logos/attach") {
    const record = extras.body && typeof extras.body === "object" ? (extras.body as Record<string, unknown>) : {};
    const poolId = typeof record.poolId === "string" ? record.poolId : "";
    const url = typeof record.url === "string" ? record.url : "";
    const signature = typeof record.signature === "string" ? record.signature : "";
    let nonce = 0n;
    let expiry = 0n;
    try {
      nonce = BigInt(typeof record.nonce === "string" ? record.nonce : "");
      expiry = BigInt(typeof record.expiry === "string" ? record.expiry : "");
    } catch {
      return { status: 401, json: { error: "signature required" } };
    }
    if (!extras.authorizeAttach || !signature) return { status: 401, json: { error: "signature required" } };
    const auth = await extras.authorizeAttach({ poolId, url, nonce, expiry, signature });
    if (!auth.ok) return { status: auth.status, json: { error: auth.error } };
    attachLogo(poolId, url);
    return { status: 200, json: { ok: true } };
  }
  if (method === "POST" && path === "/metadata") {
    const record = extras.body && typeof extras.body === "object" ? (extras.body as Record<string, unknown>) : {};
    return { status: 200, json: cleanSocials(record) };
  }
  if (method !== "GET") return { status: 405, json: { error: "GET only" } };
  const chainId = elysiumTestnet.id;
  if (path === "/health") return { status: 200, json: { ok: true, chainId } };
  if (path === "/price/hype") {
    const quote = await hypeQuote();
    return { status: 200, json: quote };
  }
  if (path === "/stats") {
    const coins = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM coins WHERE chain_id = $1`, [chainId]);
    // amount_in is pair-token (WHYPE) wei spent by buybacks. coin_burned is coin units and must not be priced as HYPE.
    const burned = await db.query<{ n: string }>(
      `SELECT COALESCE(SUM(amount_in), 0)::text AS n FROM buybacks WHERE chain_id = $1`,
      [chainId],
    );
    const kick = await db.query<{ n: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS n FROM kickback_payouts WHERE chain_id = $1`,
      [chainId],
    );
    const hypeSide = `((c.coin_is_token0 AND NOT s.zero_for_one) OR (NOT c.coin_is_token0 AND s.zero_for_one))`;
    const volume = await db.query<{ n: string }>(
      `SELECT COALESCE(SUM(s.amount_in), 0)::text AS n FROM swaps s JOIN coins c ON c.pool_id = s.pool_id WHERE s.chain_id = $1 AND s.block_time > now() - interval '1 day' AND ${hypeSide}`,
      [chainId],
    );
    const volumeAll = await db.query<{ n: string }>(
      `SELECT COALESCE(SUM(s.amount_in), 0)::text AS n FROM swaps s JOIN coins c ON c.pool_id = s.pool_id WHERE s.chain_id = $1 AND ${hypeSide}`,
      [chainId],
    );
    const num = (rows: { n: string }[]) => rows[0]?.n ?? "0";
    return {
      status: 200,
      json: {
        coins: num(coins.rows),
        burned: num(burned.rows),
        kickback: num(kick.rows),
        volume24h: num(volume.rows),
        volumeAll: num(volumeAll.rows),
      },
    };
  }
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
    const overlay = tokenOverlay(extras.tokenListPath);
    return { status: 200, json: { coins: res.rows.map((row) => coinJson(row, overlay)) } };
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
  const coinPath = path.match(/^\/coins\/0x([0-9a-fA-F]{64})(\/chart|\/holders|\/swaps|\/kickbacks|\/claims)?$/);
  if (!coinPath?.[1]) return { status: 404, json: { error: "not found" } };
  const id = coinPath[1];
  if (!POOL.test(id)) return { status: 400, json: { error: "bad pool" } };
  const pool = hexParam(id);
  const tail = coinPath[2] ?? "";
  if (tail === "") {
    const res = await db.query<CoinRow>(`${coinSelect} WHERE c.chain_id = $1 AND c.pool_id = $2`, [chainId, pool]);
    const row = res.rows[0];
    if (!row) return { status: 404, json: { error: "not found" } };
    return { status: 200, json: coinJson(row, tokenOverlay(extras.tokenListPath)) };
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
      [chainId, pool, limitOf(query, 5000)],
    );
    return {
      status: 200,
      json: { holders: res.rows.map((row) => ({ account: prefixed(String(row.account)), balance: String(row.balance) })) },
    };
  }
  if (tail === "/claims") {
    const account = query.get("account") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return { status: 400, json: { error: "bad address" } };
    const claims = await claimsForPool(`0x${id}`, account);
    return { status: 200, json: { claims } };
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
    `SELECT e.epoch::text AS epoch, e.funded::text AS funded, e.carry::text AS carry,
            e.sealed_amount::text AS sealed_amount, encode(e.root, 'hex') AS root, e.cancelled,
            extract(epoch from e.start_time) AS start_time, extract(epoch from e.end_time) AS end_time,
            COALESCE((SELECT SUM(amount) FROM kickback_payouts p
                      WHERE p.chain_id = e.chain_id AND p.pool_id = e.pool_id AND p.epoch = e.epoch
                        AND p.kind = 'GasReimbursed'), 0)::text AS gas_reimbursed,
            COALESCE((SELECT SUM(amount) FROM kickback_payouts p
                      WHERE p.chain_id = e.chain_id AND p.pool_id = e.pool_id AND p.epoch = e.epoch
                        AND p.kind IN ('Pushed', 'KickbackClaimed', 'FailedPull')), 0)::text AS net_distributed
     FROM kickback_epochs e WHERE e.chain_id = $1 AND e.pool_id = $2 ORDER BY e.epoch DESC LIMIT $3`,
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
        gasReimbursed: String(row.gas_reimbursed ?? "0"),
        netDistributed: String(row.net_distributed ?? "0"),
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
