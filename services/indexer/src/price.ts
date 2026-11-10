export { coinPrice, formatRatio } from "@seedix/shared";

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
