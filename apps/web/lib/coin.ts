export type Mode = "keep" | "kickback" | "burn";

export type Coin = {
  id: string;
  name: string;
  ticker: string;
  pair: string;
  mode: Mode;
  ageSec: number;
  launchTime?: number;
  description: string;
  recipient: `0x${string}`;
  mcap?: number;
  price?: number;
  holders?: number;
  creator?: string;
  coinIsToken0?: boolean;
  tokenAddress?: `0x${string}`;
  pairAddress?: `0x${string}`;
  hooks?: `0x${string}`;
  poolId?: `0x${string}`;
  category?: "crypto" | "stock" | "preipo";
  website?: string | null;
  x?: string | null;
  telegram?: string | null;
};

export function modeLabel(mode: Mode): string {
  if (mode === "keep") return "Keep";
  if (mode === "kickback") return "Kick back";
  return "Burn";
}

export function coinAge(coin: Coin, nowSec: number): number {
  if (coin.launchTime !== undefined) return Math.max(0, nowSec - coin.launchTime);
  return coin.ageSec;
}
