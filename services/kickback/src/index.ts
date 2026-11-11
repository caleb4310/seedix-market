import { elysiumTestnet } from "@seedix/shared";
import { leaf as roundLeaf } from "./round.ts";
export { allocate, buildRound, buildTree, leaf as roundLeaf, verifyProof } from "./round.ts";

/**
 * Hourly publisher. Epochs are timestamp windows, never block ranges.
 * The publisher key can only fund and post roots. It cannot cancel.
 * Excluded from every manifest: pool manager, hook, locker, executor,
 * distributor, vault, the zero address, the dead address, the coin's team
 * wallet, and any contract that the timelock has not allowlisted.
 * The keeper pushes the posted leaves in batches. Dust rolls forward.
 */
export const kickbackConfig = {
  chainId: elysiumTestnet.id,
  reviewSeconds: 60 * 60,
  epochSeconds: 60 * 60,
  databaseUrl: process.env.DATABASE_URL ?? "",
};

/** Matches KickbackDistributor. The keeper repeats push until the round is sealed. */
export const autoPush = {
  maxBatch: 32,
  dustWei: 1_000_000n,
  gasCapBps: 200,
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

export function main(): void {
  console.log(
    `kickback publisher for chain ${kickbackConfig.chainId}. Rounds are built off chain. Mainnet launches cannot select Kickback mode, and this process does not broadcast fund or postRoot.`,
  );
}
