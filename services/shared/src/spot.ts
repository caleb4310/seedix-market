const Q192 = 1n << 192n;

/** LaunchToken mints this many raw units. Burns are the only thing that reduces it. */
export const LAUNCH_SUPPLY = 1_000_000_000n * 10n ** 18n;

/** `numerator / denominator` as a decimal string with up to `scale` fractional digits. */
export function formatRatio(numerator: bigint, denominator: bigint, scale = 18): string {
  if (denominator <= 0n || numerator === 0n) return "0";
  const negative = numerator < 0n;
  const scaled = ((negative ? -numerator : numerator) * 10n ** BigInt(scale)) / denominator;
  const text = scaled.toString().padStart(scale + 1, "0");
  const whole = text.slice(0, text.length - scale);
  const fraction = text.slice(text.length - scale).replace(/0+$/, "");
  const out = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${out}` : out;
}

/**
 * Price of one raw coin unit in raw pair units.
 * Uniswap stores token1 per token0 as `(sqrtPriceX96 / 2^96)^2`.
 */
export function coinPrice(sqrtPriceX96: bigint, coinIsToken0: boolean): string {
  if (sqrtPriceX96 <= 0n) return "0";
  const squared = sqrtPriceX96 * sqrtPriceX96;
  return coinIsToken0 ? formatRatio(squared, Q192) : formatRatio(Q192, squared);
}

/**
 * Live market cap in human pair-token units: raw pair-per-coin price times raw supply.
 * Null when the pool has no price yet.
 */
export function marketCapFromSpot(price: string, supplyRaw: bigint, pairDecimals: number): string | null {
  if (!/^\d+(\.\d+)?$/.test(price) || price === "0") return null;
  if (supplyRaw <= 0n || !Number.isInteger(pairDecimals) || pairDecimals < 0 || pairDecimals > 36) return null;
  const [whole, frac = ""] = price.split(".");
  const digits = BigInt(`${whole}${frac}`);
  if (digits === 0n) return null;
  const pairRaw = (digits * supplyRaw) / 10n ** BigInt(frac.length);
  return formatRatio(pairRaw, 10n ** BigInt(pairDecimals));
}
