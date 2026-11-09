import { elysiumTestnet, pins } from "@seedix/shared";

/**
 * Week 1 skeleton. Ponder wiring lands in week 2.
 * The process reads launches, FeesTaken, claims, and buybacks from chain 99801.
 */
export const indexerConfig = {
  chainId: elysiumTestnet.id,
  rpcUrl: elysiumTestnet.rpcUrls[0],
  v4Core: pins.v4Core,
  databaseUrl: process.env.DATABASE_URL ?? "",
};

export function main(): void {
  if (!indexerConfig.databaseUrl) {
    console.log("indexer skeleton: set DATABASE_URL to the host launchpad database");
    return;
  }
  console.log(`indexer skeleton ready for chain ${indexerConfig.chainId}`);
}
