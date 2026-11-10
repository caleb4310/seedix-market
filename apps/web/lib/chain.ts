import { defineChain } from "viem";
import { elysiumTestnet as raw } from "@seedix/shared";
import { deployment, explorerOrigin } from "./deployment";

const DEFAULT_RPC = "https://testnet-rpc.elysium.kinetiq.xyz";

/** Primary RPC, then any comma-separated fallbacks. The public Elysium endpoint is the default. */
export function rpcUrlList(): string[] {
  const primary = (process.env.NEXT_PUBLIC_RPC_URL || deployment.rpcUrl || DEFAULT_RPC).trim();
  const extra = (process.env.NEXT_PUBLIC_RPC_URLS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== primary);
  return [primary, ...extra];
}

const rpc = rpcUrlList()[0] ?? DEFAULT_RPC;
const chainId = process.env.NEXT_PUBLIC_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_CHAIN_ID) : deployment.chainId;

/** Kinetiq Elysium testnet. viem's built-in `elysiumTestnet` is a different chain.
 *  NEXT_PUBLIC_RPC_URL and NEXT_PUBLIC_CHAIN_ID point a local dev server at a fork. Leave both unset for 99801.
 */
export const elysiumTestnet = defineChain({
  id: chainId,
  name: chainId === raw.id ? deployment.name : "Local Anvil",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: rpcUrlList() } },
  blockExplorers: {
    default: { name: "Elysium Testnet Explorer", url: explorerOrigin() },
  },
  testnet: true,
});
