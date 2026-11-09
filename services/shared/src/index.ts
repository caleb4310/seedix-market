export const elysiumTestnet = {
  id: 99801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: ["https://testnet-rpc.elysium.kinetiq.xyz"],
  blockExplorerUrls: ["https://testnet.elysium.kinetiq.xyz"],
} as const;

export const elysiumMainnet = {
  id: 99901,
  name: "Elysium",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: ["https://rpc.elysium.kinetiq.xyz"],
  blockExplorerUrls: ["https://elyscan.live"],
} as const;

/** Mainnet addresses are reference only. This repository does not deploy there. */
export const referenceAddresses = {
  99801: {
    whype: "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234",
    usdc: "0x7D29d8047B905000459c0E80c34a26CeedcB47b2",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    feeWallet: "0xf4383D1Ecfb525294A266929c7D4796314a764F9",
  },
  99901: {
    poolManager: "0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1",
    positionManager: "0x1d1c51b9d07fd27d36412a2b66cc23d19eb3e518",
    stateView: "0x27ed73ae0652fdcf71d6793412a7525f32be9dfe",
    quoter: "0x379f556c5a748bd7cc9baf0f7a344094ac1814f5",
    universalRouter: "0xa13f7611115752deb2b13813bdde16a5073e4b45",
    whype: "0xbA876237B0F021A6c6D852d6c26E107997cC5E81",
    feeWallet: "0xf4383D1Ecfb525294A266929c7D4796314a764F9",
  },
} as const;

export const pins = {
  v4Core: "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
  v4Periphery: "c6e4754dab11bd38c6f08ac51c3c868569e93d64",
} as const;

export type Mode = "keep" | "kickback" | "burn";
