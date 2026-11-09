import { elysiumTestnet } from "@seedix/shared";

/**
 * Hourly publisher. Epochs are timestamp windows, never block ranges.
 * The publisher key can only fund and post roots. It cannot cancel.
 * Excluded from every manifest: pool manager, hook, locker, executor,
 * distributor, vault, the zero address, and the dead address.
 */
export const kickbackConfig = {
  chainId: elysiumTestnet.id,
  reviewSeconds: 60 * 60,
  epochSeconds: 60 * 60,
  databaseUrl: process.env.DATABASE_URL ?? "",
};

export const excludedRoles = [
  "poolManager",
  "hook",
  "locker",
  "executor",
  "distributor",
  "vault",
  "zero",
  "dead",
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
  return JSON.stringify(parts);
}

export function main(): void {
  console.log(`kickback skeleton for chain ${kickbackConfig.chainId}`);
}
