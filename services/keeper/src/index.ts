import { elysiumTestnet } from "@seedix/shared";

/** Buyback keeper. Anyone can trigger a guarded buyback; this process just does it on a timer. */
export const keeperConfig = {
  chainId: elysiumTestnet.id,
  rpcUrl: elysiumTestnet.rpcUrls[0],
  minIntervalSeconds: 5 * 60,
  twapWindowSeconds: 30 * 60,
};

export function main(): void {
  console.log(`keeper skeleton for chain ${keeperConfig.chainId}`);
}
