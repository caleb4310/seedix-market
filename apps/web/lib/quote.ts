export const DEFAULT_SLIPPAGE_PCT = 1;

export type Side = "buy" | "sell";

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

export function formatAmount(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: digits });
  return n.toPrecision(4);
}
