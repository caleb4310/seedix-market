const MIN_SQRT_PRICE = 4295128739n;
const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals are unavailable.");
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Enter a token amount.");
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) throw new Error("Too many decimal places for this token.");
  const digits = frac.padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(digits || "0");
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

/** Floor of amount × (1 − slippage%). The percent is the number the user typed. */
export function minimumFromQuote(amount: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  if (bps < 0n || bps > 10_000n) throw new Error("Slippage is out of range.");
  return (amount * (10_000n - bps)) / 10_000n;
}

/** A price limit around the current sqrt price, worse by the user's slippage. */
export function sqrtPriceLimit(sqrtPriceX96: bigint, zeroForOne: boolean, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  let limit = zeroForOne
    ? (sqrtPriceX96 * (10_000n - bps)) / 10_000n
    : (sqrtPriceX96 * (10_000n + bps)) / 10_000n;
  if (limit <= MIN_SQRT_PRICE) limit = MIN_SQRT_PRICE + 1n;
  if (limit >= MAX_SQRT_PRICE) limit = MAX_SQRT_PRICE - 1n;
  return limit;
}
