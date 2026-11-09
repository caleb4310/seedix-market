import { defineChain } from "viem";
import { elysiumTestnet as raw } from "@seedix/shared";

const rpc = process.env.NEXT_PUBLIC_RPC_URL || raw.rpcUrls[0];
const chainId = process.env.NEXT_PUBLIC_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_CHAIN_ID) : raw.id;

/** Kinetiq Elysium testnet. viem's built-in `elysiumTestnet` is a different chain.
 *  NEXT_PUBLIC_RPC_URL and NEXT_PUBLIC_CHAIN_ID point a local dev server at Anvil. Leave both unset for 99801.
 */
export const elysiumTestnet = defineChain({
  id: chainId,
  name: chainId === raw.id ? raw.name : "Local Anvil",
  nativeCurrency: raw.nativeCurrency,
  rpcUrls: { default: { http: [rpc] } },
  blockExplorers: {
    default: { name: "Elysium Testnet Explorer", url: raw.blockExplorerUrls[0] },
  },
  testnet: true,
});
