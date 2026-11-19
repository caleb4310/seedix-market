import { defineChain } from "viem";
import { activeChain } from "@seedix/shared";
import { explorerOrigin } from "./deployment";

const selected = activeChain({
  CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID || process.env.CHAIN_ID,
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NATIVE_CURRENCY_SYMBOL: process.env.NEXT_PUBLIC_NATIVE_SYMBOL,
  NEXT_PUBLIC_NATIVE_SYMBOL: process.env.NEXT_PUBLIC_NATIVE_SYMBOL,
  CHAIN_NAME: process.env.NEXT_PUBLIC_CHAIN_NAME,
  NEXT_PUBLIC_CHAIN_NAME: process.env.NEXT_PUBLIC_CHAIN_NAME,
  EXPLORER_TX_URL_TEMPLATE: process.env.NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE,
  NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE: process.env.NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE,
  PRICE_COINGECKO_ID: process.env.NEXT_PUBLIC_PRICE_ID,
});

/** Primary RPC, then any comma-separated fallbacks. */
export function rpcUrlList(): string[] {
  const primary = selected.rpcUrls[0] ?? "";
  const extra = (process.env.NEXT_PUBLIC_RPC_URLS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== primary);
  return [primary, ...extra];
}

/** The chain this build talks to. Base Sepolia unless NEXT_PUBLIC_CHAIN_ID says otherwise. */
export const appChain = defineChain({
  id: selected.id,
  name: selected.name,
  nativeCurrency: selected.nativeCurrency,
  rpcUrls: { default: { http: rpcUrlList() } },
  blockExplorers: {
    default: { name: selected.name, url: explorerOrigin() || selected.blockExplorerUrls[0] || "" },
  },
  testnet: true,
});

/** Older name kept so existing imports still compile. It is the active chain, not always Elysium. */
export const elysiumTestnet = appChain;

export const nativeSymbol = selected.nativeCurrency.symbol;
export const wrappedSymbol = selected.wrappedSymbol;
export const chainName = selected.name;
export const chainId = selected.id;
export const priceId = selected.priceId;

export function chainPill(): string {
  if (chainId === 84532) return "BASE SEPOLIA · 84532";
  if (chainId === 99801) return "ELYSIUM TESTNET · 99801";
  return `${chainName.toUpperCase()} · ${chainId}`;
}
