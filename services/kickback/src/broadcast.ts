import { keccak256, toBytes, type Hex } from "viem";
import type { Round } from "./round.ts";

export type EpochState = {
  funded: bigint;
  postedAt: bigint;
  root: Hex;
  cancelled: boolean;
};

export const MAX_BATCH = 32;

export type PushBatch = {
  op: "push";
  epoch: bigint;
  accounts: Hex[];
  amounts: bigint[];
  proofs: Hex[][];
};

export type Step =
  | { op: "skip"; reason: string }
  | { op: "fund"; amount: bigint }
  | { op: "post"; epoch: bigint; root: Hex; manifestHash: Hex; allocated: bigint }
  | PushBatch
  | { op: "seal"; epoch: bigint };

export function manifestHash(body: string): Hex {
  return keccak256(toBytes(body));
}

export function claimSum(round: Round): bigint {
  return round.claims.reduce((sum, claim) => sum + claim.amount, 0n);
}

function pending(round: Round, claimed: ReadonlySet<string>) {
  return round.claims.flatMap((claim, index) => {
    if (claimed.has(claim.account.toLowerCase())) return [];
    return [{ claim, proof: round.proofs[index] ?? [] }];
  });
}

/** Decide the one chain call that is still missing. A paid holder is not included again. */
export function nextStep(input: {
  poolId: Hex;
  pot: bigint;
  latest: EpochState | null;
  latestId: bigint;
  round: Round | null;
  claimed?: ReadonlySet<string>;
  reviewOpen?: boolean;
  sealed?: boolean;
  paused?: boolean;
  unpriced?: boolean;
  carry?: bigint;
}): Step {
  if (input.paused) return { op: "skip", reason: "paused" };
  if (input.unpriced) return { op: "skip", reason: "reward token has no HYPE price" };
  const allocated = input.round ? claimSum(input.round) : 0n;
  const open =
    input.latest && !input.latest.cancelled && input.latest.funded > 0n && input.latest.postedAt === 0n
      ? input.latest
      : null;
  if (open) {
    if (!input.round) return { op: "skip", reason: "funded round is waiting for a holder snapshot" };
    if (allocated === 0n || allocated > open.funded) return { op: "skip", reason: "leaf total exceeds the funded amount" };
    return {
      op: "post",
      epoch: input.latestId,
      root: input.round.root,
      manifestHash: manifestHash(manifestBody(input.poolId, input.round, input.latestId)),
      allocated,
    };
  }
  if (input.latest && !input.latest.cancelled && input.latest.postedAt > 0n && !input.sealed) {
    if (!input.round || input.latest.root.toLowerCase() !== input.round.root.toLowerCase()) {
      return { op: "skip", reason: "posted round artifact is missing" };
    }
    if (!input.reviewOpen) return { op: "skip", reason: "review window" };
    const left = pending(input.round, input.claimed ?? new Set());
    if (left.length === 0) return { op: "seal", epoch: input.latestId };
    const batch = left.slice(0, MAX_BATCH);
    return {
      op: "push",
      epoch: input.latestId,
      accounts: batch.map((item) => item.claim.account),
      amounts: batch.map((item) => item.claim.amount),
      proofs: batch.map((item) => item.proof),
    };
  }
  const gross = input.pot + (input.carry ?? 0n);
  if (gross === 0n) return { op: "skip", reason: "nothing accrued" };
  if (!input.round || allocated === 0n) return { op: "skip", reason: "no payable holders" };
  if (allocated > gross) return { op: "skip", reason: "leaf total exceeds the pot" };
  return { op: "fund", amount: input.pot };
}

export function manifestBody(poolId: Hex, round: Round, epoch: bigint): string {
  return JSON.stringify({
    poolId,
    epoch: epoch.toString(),
    chainId: Number(round.chainId),
    distributor: round.distributor,
    coin: round.coin,
    pair: round.pair,
    root: round.root,
    allocated: claimSum(round).toString(),
    claims: round.claims.map((claim) => ({ account: claim.account, amount: claim.amount.toString() })),
  });
}

export function artifactName(poolId: Hex, epoch: bigint): string {
  return `${poolId.toLowerCase()}-${epoch.toString()}.json`;
}

export async function withRetry<T>(fn: () => Promise<T>, waits: readonly number[], sleep: (ms: number) => Promise<void>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= waits.length) throw err;
      await sleep(waits[attempt] ?? 0);
      attempt += 1;
    }
  }
}

/** One pass. Dry-run returns the step and does not call `send`. A crash after `fund` retries as `post`. */
export async function publishOnce(input: {
  dryRun: boolean;
  poolId: Hex;
  pot: bigint;
  latest: EpochState | null;
  latestId: bigint;
  round: Round | null;
  claimed?: ReadonlySet<string>;
  reviewOpen?: boolean;
  sealed?: boolean;
  paused?: boolean;
  unpriced?: boolean;
  carry?: bigint;
  send: (step: Exclude<Step, { op: "skip" }>) => Promise<void>;
}): Promise<Step> {
  const step = nextStep(input);
  if (step.op === "skip" || input.dryRun) return step;
  await input.send(step);
  return step;
}
