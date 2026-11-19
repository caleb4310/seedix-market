/** Selectable chains. Base Sepolia is the default. Elysium stays available when CHAIN_ID is 99801. */

export const elysiumTestnet = {
  id: 99801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  wrappedSymbol: "WHYPE",
  rpcUrls: ["https://testnet-rpc.elysium.kinetiq.xyz"],
  blockExplorerUrls: ["https://explorer-elysium-testnet.t.conduit.xyz"],
  explorerTxTemplate: "https://explorer-elysium-testnet.t.conduit.xyz/tx/{hash}",
  priceId: "hyperliquid",
  deploymentFile: "99801.json",
  startBlock: 27707424,
  zroTax: false,
} as const;

export const elysiumMainnet = {
  id: 99901,
  name: "Elysium",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  wrappedSymbol: "WHYPE",
  rpcUrls: ["https://rpc.elysium.kinetiq.xyz"],
  blockExplorerUrls: ["https://elyscan.live"],
  explorerTxTemplate: "https://elyscan.live/tx/{hash}",
  priceId: "hyperliquid",
  deploymentFile: "99901.json",
  startBlock: 0,
  zroTax: false,
} as const;

export const baseSepolia = {
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  wrappedSymbol: "WETH",
  rpcUrls: ["https://base-sepolia-rpc.publicnode.com"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
  explorerTxTemplate: "https://sepolia.basescan.org/tx/{hash}",
  priceId: "ethereum",
  deploymentFile: "base-sepolia.json",
  startBlock: 60147699,
  zroTax: true,
} as const;

export type ChainPreset = typeof baseSepolia | typeof elysiumTestnet | typeof elysiumMainnet;

const presets: readonly ChainPreset[] = [baseSepolia, elysiumTestnet, elysiumMainnet];

export function presetFor(chainId: number): ChainPreset {
  return presets.find((item) => item.id === chainId) ?? baseSepolia;
}

export type ActiveChain = {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: 18 };
  wrappedSymbol: string;
  rpcUrls: string[];
  blockExplorerUrls: readonly string[];
  explorerTxTemplate: string;
  priceId: string;
  deploymentFile: string;
  startBlock: number;
  zroTax: boolean;
};

/** Chain the process should use. CHAIN_ID wins, then NEXT_PUBLIC_CHAIN_ID, then Base Sepolia. */
export function activeChain(env: Record<string, string | undefined> = process.env): ActiveChain {
  const raw = env.CHAIN_ID || env.NEXT_PUBLIC_CHAIN_ID || String(baseSepolia.id);
  const parsed = Number(raw);
  const id = Number.isFinite(parsed) && parsed > 0 ? parsed : baseSepolia.id;
  const preset = presetFor(id);
  const symbol = (env.NATIVE_CURRENCY_SYMBOL || env.NEXT_PUBLIC_NATIVE_SYMBOL || preset.nativeCurrency.symbol).trim();
  const name = (env.CHAIN_NAME || env.NEXT_PUBLIC_CHAIN_NAME || (id === preset.id ? preset.name : "Local")).trim();
  const rpc = (env.RPC_URL || env.NEXT_PUBLIC_RPC_URL || "").trim();
  return {
    id,
    name,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    wrappedSymbol: preset.wrappedSymbol,
    rpcUrls: rpc ? [rpc] : [...preset.rpcUrls],
    blockExplorerUrls: preset.blockExplorerUrls,
    explorerTxTemplate: env.EXPLORER_TX_URL_TEMPLATE || env.NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE || preset.explorerTxTemplate,
    priceId: (env.PRICE_COINGECKO_ID || preset.priceId).trim(),
    deploymentFile: preset.deploymentFile,
    startBlock: preset.startBlock,
    zroTax: preset.zroTax,
  };
}
