import { marketCapFromRaw, marketCapUsd } from "./amounts";
import { logoSrc } from "./logoUrl";
import type { Coin, Mode } from "./coin";

export const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

/** Merkle proofs. Falls back to the API URL. Empty means the claim list is not configured. */
export const claimsUrl = (process.env.NEXT_PUBLIC_CLAIMS_URL || process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export type ApiCoin = {
  poolId: string;
  coin: string;
  pair: string;
  name: string;
  symbol: string;
  pairSymbol: string;
  mode: Mode;
  feeRecipient: string;
  launchTime: number;
  price: string | null;
  holders: number;
  category?: "crypto" | "stock" | "preipo";
  description?: string | null;
  website?: string | null;
  x?: string | null;
  telegram?: string | null;
  startMcap?: string;
  marketCap?: string | null;
  volume24h?: string;
  image?: string | null;
  backing?: string | null;
  backingSymbol?: string | null;
  backingLogo?: string | null;
  pairDecimals?: number;
  coinIsToken0?: boolean;
  pairUsd?: number | null;
};

export type Candle = { t: number; open: string; high: string; low: string; close: string; volume: string };

export type KickbackRow = {
  epoch: string;
  kind: string;
  account: string;
  amount: string;
  txHash: string;
  blockTime: number;
};

export type KickbackEpoch = {
  epoch: string;
  funded: string;
  gasReimbursed: string;
  netDistributed: string;
  carry: string;
  sealedAmount: string | null;
  cancelled: boolean;
};

const poolId = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;

export function coinPath(id: string): string | null {
  return poolId.test(id) ? `/coins/${id}` : null;
}

export function chartPath(id: string, bucket: "5m" | "1h" | "1d" = "5m"): string | null {
  const base = coinPath(id);
  return base ? `${base}/chart?bucket=${bucket}` : null;
}

export function kickbackKind(kind: string): string {
  if (kind === "Pushed") return "Push";
  if (kind === "KickbackClaimed") return "Claim";
  if (kind === "Rolled") return "Rolled";
  if (kind === "ClaimableCredited") return "Claimable";
  if (kind === "FailedPull") return "Pulled";
  if (kind === "GasReimbursed") return "Gas from the round";
  return kind;
}

export function kickbackPath(id: string): string | null {
  const base = coinPath(id);
  return base ? `${base}/kickbacks` : null;
}

export function portfolioPath(account: string): string | null {
  return address.test(account) ? `/portfolio/${account}` : null;
}

export function coinFromApi(row: ApiCoin, hook?: `0x${string}`): Coin {
  const now = Math.floor(Date.now() / 1000);
  const price = row.price === null ? undefined : Number(row.price);
  const pairDecimals = row.pairDecimals ?? 18;
  const startMcap = row.startMcap ? marketCapFromRaw(row.startMcap, pairDecimals) : undefined;
  const live = row.marketCap == null || row.marketCap === "" ? undefined : Number(row.marketCap);
  const mcap = live !== undefined && Number.isFinite(live) ? live : undefined;
  return {
    id: row.poolId,
    name: row.name || "Coin",
    ticker: row.symbol || "COIN",
    pair: row.pairSymbol || "PAIR",
    mode: row.mode,
    ageSec: Math.max(0, now - row.launchTime),
    launchTime: row.launchTime,
    description:
      row.description ||
      `${row.mode === "kickback" ? "Kick back" : row.mode === "burn" ? "Burn" : "Keep"} mode, paired with ${row.pairSymbol || "the pair token"}.`,
    category: row.category,
    website: row.website ?? null,
    x: row.x ?? null,
    telegram: row.telegram ?? null,
    recipient: row.feeRecipient as `0x${string}`,
    price: price !== undefined && Number.isFinite(price) ? price : undefined,
    mcap,
    startMcap,
    pairDecimals,
    pairUsd: row.pairUsd ?? null,
    mcapUsd: marketCapUsd(mcap, row.pairUsd),
    coinIsToken0: row.coinIsToken0,
    image: logoSrc(row.image),
    backing: row.backing ?? null,
    backingSymbol: row.backingSymbol ?? null,
    backingLogo: logoSrc(row.backingLogo),
    volume: row.volume24h ? Number(row.volume24h) : 0,
    holders: row.holders,
    tokenAddress: row.coin as `0x${string}`,
    pairAddress: row.pair as `0x${string}`,
    hooks: hook,
    poolId: row.poolId as `0x${string}`,
  };
}

async function getJson<T>(path: string): Promise<T> {
  if (!apiUrl) throw new Error("The API is not configured.");
  return getJsonFrom(apiUrl, path);
}

export function getCoins(): Promise<{ coins: ApiCoin[] }> {
  return getJson("/coins");
}

export function getChart(id: string, bucket: "5m" | "1h" | "1d" = "5m"): Promise<{ candles: Candle[] }> {
  const path = chartPath(id, bucket);
  if (!path) return Promise.reject(new Error("bad pool"));
  return getJson(path);
}

export type ClaimProof = { epoch: string; amount: string; proof: `0x${string}`[] };

export function getClaims(id: string, account: string): Promise<{ claims: ClaimProof[] }> {
  if (!claimsUrl) return Promise.reject(new Error("The API is not configured."));
  if (!poolId.test(id) || !address.test(account)) return Promise.reject(new Error("bad claim"));
  return getJsonFrom(claimsUrl, `/coins/${id}/claims?account=${account}`);
}

async function getJsonFrom<T>(base: string, path: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error("The API request failed.");
  return (await response.json()) as T;
}

export function getKickbacks(id: string): Promise<{ payouts: KickbackRow[]; epochs?: KickbackEpoch[] }> {
  const path = kickbackPath(id);
  if (!path) return Promise.reject(new Error("bad pool"));
  return getJson(path);
}

export type Portfolio = {
  balances: { poolId: string; symbol: string; name: string; balance: string }[];
  kickbacks: { poolId: string; epoch: string; kind: string; amount: string; txHash: string; blockTime: number }[];
  swaps: { poolId: string; txHash: string; zeroForOne: boolean; amountIn: string; amountOut: string; price: string; blockTime: number }[];
};

export function getPortfolio(account: string): Promise<Portfolio> {
  const path = portfolioPath(account);
  if (!path) return Promise.reject(new Error("bad address"));
  return getJson(path);
}
