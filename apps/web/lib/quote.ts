export const DEFAULT_SLIPPAGE_PCT = 1;
export const OPENING_SLIPPAGE_PCT = 3;
export const OPENING_WINDOW_SEC = 180;

/** The first three minutes after launch use a wider default. The field stays editable. */
export function initialSlippagePct(ageSec: number): number {
  return ageSec < OPENING_WINDOW_SEC ? OPENING_SLIPPAGE_PCT : DEFAULT_SLIPPAGE_PCT;
}

/** One step up from the slippage that just reverted, capped at the field maximum. */
export function suggestedSlippage(current: number): number {
  if (!Number.isFinite(current) || current < 0) return OPENING_SLIPPAGE_PCT;
  return Math.min(50, Math.max(current + 3, OPENING_SLIPPAGE_PCT));
}

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
