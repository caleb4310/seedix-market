const MIN_SQRT_PRICE = 4295128739n;
const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals are unavailable.");
  }
  const trimmed = value.trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) throw new Error("Enter a token amount.");
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) throw new Error("Too many decimal places for this token.");
  const digits = frac.padEnd(decimals, "0");
  const wholePart = whole.length > 0 ? BigInt(whole) : 0n;
  return wholePart * 10n ** BigInt(decimals) + BigInt(digits || "0");
}

export function formatTokenAmount(amount: bigint, decimals: number, maxFrac = 6): string {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const text = frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
  return negative ? `-${text}` : text;
}

function slippageBps(slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  if (bps < 0n || bps > 10_000n) throw new Error("Slippage is out of range.");
  return bps;
}

/** Floor of amount × (1 − slippage%). The percent is the number the user typed. */
export function minimumFromQuote(amount: bigint, slippagePct: number): bigint {
  const bps = slippageBps(slippagePct);
  return (amount * (10_000n - bps)) / 10_000n;
}

/** Ceiling of amount × (1 + slippage%). Used as maxIn on an exact-out swap. */
export function maximumFromQuote(amount: bigint, slippagePct: number): bigint {
  const bps = slippageBps(slippagePct);
  return (amount * (10_000n + bps) + 9_999n) / 10_000n;
}

/** The router's full range. Slippage is enforced by min-out or max-in, not by a tight price limit. */
export function extremeSqrtPriceLimit(zeroForOne: boolean): bigint {
  return zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n;
}
