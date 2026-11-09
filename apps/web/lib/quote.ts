import { fees } from "./tokens";

export const DEFAULT_SLIPPAGE_PCT = 1;

export type Side = "buy" | "sell";

export type TradeQuote = {
  hookAmt: number;
  platAmt: number;
  lpAmt: number;
  toPool: number;
  impact: number;
  received: number;
  minReceived: number;
  hookUnit: "pair" | "coin";
  receiveUnit: "pair" | "coin";
};

export type Slippage =
  | { ok: true; pct: number; warn: boolean }
  | { ok: false; message: string };

/** Reads the field as typed. It does not clamp or rewrite the number. */
export function parseSlippage(raw: string): Slippage {
  const text = raw.trim();
  if (text === "") return { ok: false, message: "Enter a slippage percent." };
  const pct = Number(text);
  if (!Number.isFinite(pct)) return { ok: false, message: "Slippage must be a number." };
  if (pct < 0) return { ok: false, message: "Slippage cannot be negative." };
  if (pct > 50) return { ok: false, message: "Slippage cannot be above 50%." };
  return { ok: true, pct, warn: pct > 5 };
}

/** Constant-price quote with a size impact, matching the hook's fee direction. */
export function tradeQuote(input: {
  side: Side;
  amount: number;
  price: number;
  mcap: number;
  hookPips: number;
  slippagePct: number;
}): TradeQuote {
  const gross = Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0;
  const hook = input.hookPips / fees.pips;
  const platform = fees.platformPips / fees.pips;
  const slip = input.slippagePct / 100;
  const price = input.price > 0 ? input.price : 0;

  if (input.side === "buy") {
    const hookAmt = gross * hook;
    const platAmt = gross * platform;
    const toPool = Math.max(0, gross - hookAmt - platAmt);
    const impact = input.mcap > 0 ? Math.min(0.9, toPool / input.mcap) : 0;
    const received = price > 0 ? (toPool / price) * (1 - impact) : 0;
    return {
      hookAmt,
      platAmt,
      lpAmt: toPool * (fees.lpPips / fees.pips),
      toPool,
      impact,
      received,
      minReceived: received * (1 - slip),
      hookUnit: "pair",
      receiveUnit: "coin",
    };
  }

  const hookAmt = gross * hook;
  const toPool = Math.max(0, gross - hookAmt);
  const grossProceeds = toPool * price;
  const impact = input.mcap > 0 ? Math.min(0.9, grossProceeds / input.mcap) : 0;
  const afterImpact = grossProceeds * (1 - impact);
  const platAmt = afterImpact * platform;
  const received = Math.max(0, afterImpact - platAmt);
  return {
    hookAmt,
    platAmt,
    lpAmt: toPool * (fees.lpPips / fees.pips),
    toPool,
    impact,
    received,
    minReceived: received * (1 - slip),
    hookUnit: "coin",
    receiveUnit: "pair",
  };
}

export function formatAmount(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: digits });
  return n.toPrecision(4);
}

export function formatPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const raw = n.toFixed(18);
  const match = raw.match(/^0\.(0+)([1-9]\d{0,3})/);
  if (!match) return `$${n.toPrecision(4)}`;
  const zeros = match[1].length;
  if (zeros < 3) return `$${n.toPrecision(4)}`;
  const sub = String(zeros)
    .split("")
    .map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)])
    .join("");
  return `$0.0${sub}${match[2]}`;
}

export function formatImpact(impact: number): string {
  const pct = impact * 100;
  if (pct < 0.01) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}
