const INTERVAL = 300n;

/** Halve until nothing is left, so a quote that cannot fill the whole pot can try a smaller one. */
export function amountSteps(amount: bigint): bigint[] {
  const steps: bigint[] = [];
  let left = amount;
  while (left > 0n && steps.length < 6) {
    steps.push(left);
    left /= 2n;
  }
  return steps;
}

/** Coin buybacks wait out the 5 minute interval and never ask for more than the pot or the cap. */
export function planCoinBuyback(pot: bigint, cap: bigint, lastBuybackAt: bigint, now: bigint, interval = INTERVAL): bigint[] {
  if (pot === 0n || cap === 0n) return [];
  if (lastBuybackAt !== 0n && now < lastBuybackAt + interval) return [];
  const amount = pot < cap ? pot : cap;
  return amountSteps(amount);
}

export function planPlatformBuyback(pot: bigint, cap: bigint, lastPlatformAt: bigint, now: bigint, interval = INTERVAL): bigint[] {
  return planCoinBuyback(pot, cap, lastPlatformAt, now, interval);
}

export const PUSH_BATCH = 32;

/** Skip a transaction whose estimate exceeds the gas limit or whose fee exceeds the cap. */
export function feeWithinCap(gas: bigint, maxFeePerGas: bigint, maxFeeCap: bigint, gasLimit: bigint): boolean {
  if (gas <= 0n || maxFeePerGas <= 0n || maxFeeCap <= 0n || gasLimit <= 0n) return false;
  if (gas > gasLimit) return false;
  return maxFeePerGas <= maxFeeCap;
}

/** One poll that skipped work and bought nothing back should page an operator. */
export function buybacksStalled(buybacks: number, skips: number): boolean {
  return buybacks === 0 && skips > 0;
}

/** A round is sealed only after every push batch was accepted. */
export function shouldSeal(batchOk: readonly boolean[]): boolean {
  return batchOk.length > 0 && batchOk.every(Boolean);
}

export function pushBatches<T>(items: readonly T[], size = PUSH_BATCH): T[][] {
  if (size < 1) throw new Error("batch");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A posted epoch can be pushed only after the review hour. */
export function pushReady(postedAt: bigint, now: bigint, cancelled: boolean, review = 3600n): boolean {
  if (cancelled || postedAt === 0n) return false;
  return now >= postedAt + review;
}
