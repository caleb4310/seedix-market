import { buildRound, buildTree, leaf, type Claim, type Holder, type Round } from "./round.ts";
import type { Address, Hex } from "viem";

/** Matches KickbackDistributor.MAX_GAS_CAP_BPS. 200 / 10_000 = 2%. */
export const GAS_CAP_BPS = 200n;
export const BPS = 10_000n;
export const MAX_BATCH = 32n;
/** One HYPE, in wei. A WHYPE reward uses this as reward-per-HYPE. */
export const WAD = 10n ** 18n;
/**
 * Conservative gas for one holder inside a push: proof check, skip test, and the token transfer.
 * Measured pushes land under this. Over-estimating skips a few more small holders into the next round.
 */
export const GAS_PER_HOLDER = 120_000n;
/** Base cost of a push transaction on top of the per-holder cost. */
export const GAS_PER_BATCH = 80_000n;

export type GasPlan = {
  gross: bigint;
  /** Hard ceiling, in reward-token wei. The contract will not reimburse more than this. */
  cap: bigint;
  /** What holders can be allocated this round. The cap stays behind and unused gas rolls forward. */
  distributable: bigint;
  /** Shares below this are left out of the tree so they roll forward. */
  skipBelow: bigint;
  /** Estimated reimbursement in reward-token wei, after the cap. */
  reserve: bigint;
  hypeCost: bigint;
  holderCount: bigint;
  batches: bigint;
  /** True when the reward is not HYPE and the TWAP quote is missing. Do not broadcast. */
  unpriced: boolean;
};

export function batchCount(holders: bigint): bigint {
  if (holders <= 0n) return 0n;
  return (holders + MAX_BATCH - 1n) / MAX_BATCH;
}

export function distributionGas(holders: bigint): bigint {
  if (holders <= 0n) return 0n;
  return GAS_PER_BATCH * batchCount(holders) + GAS_PER_HOLDER * holders;
}

/** HYPE wei to reward-token wei. WHYPE (rewardPerHype == 1e18) is 1:1. */
export function toReward(hypeWei: bigint, rewardPerHype: bigint): bigint {
  if (hypeWei === 0n || rewardPerHype === 0n) return 0n;
  if (rewardPerHype === WAD) return hypeWei;
  return (hypeWei * rewardPerHype) / WAD;
}

export function planGas(input: {
  pot: bigint;
  holderCount: bigint;
  gasPrice: bigint;
  rewardPerHype: bigint;
  dust: bigint;
  capBps?: bigint;
  rewardIsHype?: boolean;
}): GasPlan {
  const capBps = input.capBps ?? GAS_CAP_BPS;
  const gross = input.pot;
  const cap = (gross * capBps) / BPS;
  const distributable = gross > cap ? gross - cap : 0n;
  const unpriced = input.rewardIsHype === false && input.rewardPerHype === 0n;
  const hypeCost = distributionGas(input.holderCount) * input.gasPrice;
  const estimated = unpriced ? 0n : toReward(hypeCost, input.rewardPerHype === 0n ? WAD : input.rewardPerHype);
  const reserve = estimated > cap ? cap : estimated;
  const perHolder = unpriced ? input.dust : toReward(GAS_PER_HOLDER * input.gasPrice, input.rewardPerHype === 0n ? WAD : input.rewardPerHype);
  const skipBelow = perHolder > input.dust ? perHolder : input.dust;
  return {
    gross,
    cap,
    distributable,
    skipBelow,
    reserve,
    hypeCost,
    holderCount: input.holderCount,
    batches: batchCount(input.holderCount),
    unpriced,
  };
}

function smallestIndex(claims: readonly Claim[]): number {
  let index = 0;
  for (let i = 1; i < claims.length; i += 1) {
    const claim = claims[i];
    const best = claims[index];
    if (claim && best && claim.amount < best.amount) index = i;
  }
  return index;
}

/** Drop the smallest shares until the estimated gas fits under the cap. Dropped shares are not reassigned. */
export function trimToCap(claims: readonly Claim[], plan: GasPlan, gasPrice: bigint, rewardPerHype: bigint): Claim[] {
  const kept = [...claims];
  const rate = rewardPerHype === 0n ? WAD : rewardPerHype;
  while (kept.length > 0 && toReward(distributionGas(BigInt(kept.length)) * gasPrice, rate) > plan.cap) {
    kept.splice(smallestIndex(kept), 1);
  }
  return kept;
}

export function buildPayableRound(input: {
  chainId: bigint;
  distributor: Address;
  coin: Address;
  pair: Address;
  epoch: bigint;
  holders: readonly Holder[];
  pot: bigint;
  dust: bigint;
  gasPrice: bigint;
  rewardPerHype: bigint;
  rewardIsHype?: boolean;
  excluded?: readonly string[];
  capBps?: bigint;
}): { round: Round | null; plan: GasPlan } {
  const eligible = input.holders.filter((holder) => holder.balance > 0n).length;
  const plan = planGas({
    pot: input.pot,
    holderCount: BigInt(eligible),
    gasPrice: input.gasPrice,
    rewardPerHype: input.rewardPerHype,
    dust: input.dust,
    capBps: input.capBps,
    rewardIsHype: input.rewardIsHype,
  });
  if (plan.unpriced || plan.distributable === 0n) return { round: null, plan };
  const built = buildRound({
    chainId: input.chainId,
    distributor: input.distributor,
    coin: input.coin,
    pair: input.pair,
    epoch: input.epoch,
    holders: input.holders,
    pot: plan.distributable,
    dust: plan.skipBelow,
    excluded: input.excluded,
  });
  if (!built) return { round: null, plan };
  const kept = trimToCap(built.claims, plan, input.gasPrice, input.rewardPerHype);
  if (kept.length === built.claims.length) {
    return { round: built, plan: { ...plan, holderCount: BigInt(kept.length), batches: batchCount(BigInt(kept.length)) } };
  }
  if (kept.length === 0) return { round: null, plan: { ...plan, holderCount: 0n, batches: 0n, reserve: 0n } };
  const leaves = kept.map((claim) =>
    leaf({
      chainId: input.chainId,
      distributor: input.distributor,
      coin: input.coin,
      pair: input.pair,
      epoch: input.epoch,
      account: claim.account,
      amount: claim.amount,
    }),
  );
  const tree = buildTree(leaves);
  const round: Round = { ...built, claims: kept, root: tree.root, proofs: tree.proofs };
  return {
    round,
    plan: { ...plan, holderCount: BigInt(kept.length), batches: batchCount(BigInt(kept.length)) },
  };
}

export function conserves(gross: bigint, net: bigint, gas: bigint, rolled: bigint): boolean {
  return net + gas + rolled === gross;
}

export type { Claim, Hex };
