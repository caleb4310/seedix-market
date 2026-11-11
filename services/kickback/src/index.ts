import { configuredChainId } from "@seedix/shared";
import { leaf as roundLeaf } from "./round.ts";
export { allocate, buildRound, buildTree, leaf as roundLeaf, verifyProof } from "./round.ts";

/**
 * Hourly publisher. Epochs are timestamp windows, never block ranges.
 * The publisher funds a round, posts the root, then pushes batches itself.
 * Gas is paid from the round. The key cannot cancel.
 * Excluded from every round: pool manager, hook, locker, executor,
 * distributor, vault, the zero address, the dead address, the coin's team
 * wallet, and contracts. Dust and shares below one holder's gas roll forward.
 */
export const kickbackConfig = {
  get chainId() {
    return configuredChainId();
  },
  reviewSeconds: 60 * 60,
  epochSeconds: 60 * 60,
  databaseUrl: process.env.DATABASE_URL ?? "",
};

/** Matches KickbackDistributor. Push repeats in batches of 32 until the round is sealed. */
export const autoPush = {
  maxBatch: 32,
  dustWei: 1_000_000n,
  gasCapBps: 100,
} as const;

export const excludedRoles = [
  "poolManager",
  "hook",
  "locker",
  "executor",
  "distributor",
  "vault",
  "zero",
  "dead",
  "teamWallet",
  "unallowlistedContract",
] as const;

/**
 * The on-chain leaf is the double hash
 * `keccak256(bytes.concat(keccak256(abi.encode(chainId, distributor, coin, pair, epochId, account, amount))))`.
 * Field order is fixed. JSON is not a leaf.
 */
export const LEAF_FIELDS = [
  "uint256 chainId",
  "address distributor",
  "address coin",
  "address pair",
  "uint64 epochId",
  "address account",
  "uint256 amount",
] as const;

export function leaf(parts: {
  chainId: number;
  distributor: string;
  asset: string;
  rewardToken: string;
  epoch: bigint;
  recipient: string;
  amount: bigint;
}): string {
  return roundLeaf({
    chainId: BigInt(parts.chainId),
    distributor: parts.distributor as `0x${string}`,
    coin: parts.asset as `0x${string}`,
    pair: parts.rewardToken as `0x${string}`,
    epoch: parts.epoch,
    account: parts.recipient as `0x${string}`,
    amount: parts.amount,
  });
}

export async function main(): Promise<void> {
  const { runPublisher } = await import("./run.ts");
  await runPublisher();
}
