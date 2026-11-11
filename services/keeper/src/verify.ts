export type Balance = { account: string; balance: bigint };
export type Payout = { account: string; amount: bigint };

/**
 * Recompute the fair share of each posted account from holder balances.
 * A leaf larger than that share, or a total above the pot after the gas reserve, is rejected.
 */
export function withinProRata(input: {
  claims: readonly Payout[];
  holders: readonly Balance[];
  pot: bigint;
  gasBps: bigint;
  excluded?: readonly string[];
}): boolean {
  if (input.claims.length === 0 || input.pot <= 0n) return false;
  const skip = new Set((input.excluded ?? []).map((item) => item.toLowerCase()));
  const eligible = input.holders.filter((holder) => holder.balance > 0n && !skip.has(holder.account.toLowerCase()));
  const supply = eligible.reduce((sum, holder) => sum + holder.balance, 0n);
  if (supply === 0n) return false;
  const reserve = (input.pot * input.gasBps) / 10_000n;
  const net = input.pot > reserve ? input.pot - reserve : 0n;
  let sum = 0n;
  for (const claim of input.claims) {
    if (claim.amount <= 0n) return false;
    const holder = eligible.find((item) => item.account.toLowerCase() === claim.account.toLowerCase());
    if (!holder) return false;
    const max = (net * holder.balance) / supply;
    if (claim.amount > max) return false;
    sum += claim.amount;
  }
  return sum <= net;
}
