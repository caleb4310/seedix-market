const Q192 = 1n << 192n;

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
 * Price of the coin in pair tokens.
 * Uniswap stores token1 per token0 as `(sqrtPriceX96 / 2^96)^2`.
 */
export function coinPrice(sqrtPriceX96: bigint, coinIsToken0: boolean): string {
  if (sqrtPriceX96 <= 0n) return "0";
  const squared = sqrtPriceX96 * sqrtPriceX96;
  return coinIsToken0 ? formatRatio(squared, Q192) : formatRatio(Q192, squared);
}

/** Pool deltas: a positive amount is what the pool received (the trader paid). */
export function swapLegs(amount0: bigint, amount1: bigint): { zeroForOne: boolean; amountIn: bigint; amountOut: bigint } {
  const zeroForOne = amount0 > 0n;
  const amountIn = zeroForOne ? amount0 : amount1 > 0n ? amount1 : 0n;
  const paidOut = zeroForOne ? amount1 : amount0;
  const amountOut = paidOut < 0n ? -paidOut : 0n;
  return { zeroForOne, amountIn, amountOut };
}

/** The highest block that has `confirmations` blocks built on top of it. */
export function confirmedTip(head: bigint, confirmations = 12n): bigint | null {
  if (confirmations < 0n) throw new Error("confirmations");
  if (head < confirmations) return null;
  return head - confirmations;
}

export function nextRange(
  cursor: bigint | null,
  startBlock: bigint,
  head: bigint,
  span = 2000n,
  overlap = 12n,
): { from: bigint; to: bigint } | null {
  let from = cursor === null ? startBlock : cursor + 1n - overlap;
  if (from < startBlock) from = startBlock;
  if (from > head) return null;
  const to = head - from + 1n > span ? from + span - 1n : head;
  return { from, to };
}
