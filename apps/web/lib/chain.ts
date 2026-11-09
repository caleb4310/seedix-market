import { defineChain } from "viem";
import { elysiumTestnet as raw } from "@seedix/shared";

/** Kinetiq Elysium testnet. viem's built-in `elysiumTestnet` is a different chain. */
export const elysiumTestnet = defineChain({
  id: raw.id,
  name: raw.name,
  nativeCurrency: raw.nativeCurrency,
  rpcUrls: { default: { http: [...raw.rpcUrls] } },
  blockExplorers: {
    default: { name: "Elysium Testnet Explorer", url: raw.blockExplorerUrls[0] },
  },
  testnet: true,
});
