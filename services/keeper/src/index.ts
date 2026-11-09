import { deployment99801, elysiumTestnet } from "@seedix/shared";

/** Buyback keeper. Anyone can trigger a guarded buyback; this process just does it on a timer. */
export const keeperConfig = {
  chainId: elysiumTestnet.id,
  rpcUrl: elysiumTestnet.rpcUrls[0],
  minIntervalSeconds: 5 * 60,
  twapWindowSeconds: 30 * 60,
  executor: process.env.BUYBACK_EXECUTOR ?? deployment99801.buybackExecutor,
  distributor: process.env.KICKBACK_DISTRIBUTOR ?? deployment99801.kickbackDistributor,
  keeper: process.env.KEEPER_ADDRESS ?? deployment99801.keeper,
};

export function main(): void {
  console.log(`keeper skeleton for chain ${keeperConfig.chainId}`);
}
