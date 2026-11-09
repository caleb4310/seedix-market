export const elysiumTestnet = {
  id: 99801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: ["https://testnet-rpc.elysium.kinetiq.xyz"],
  blockExplorerUrls: ["https://explorer-elysium-testnet.t.conduit.xyz"],
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

/** Live 99801 deployment. Matches deployments/99801.json. Indexer starts at the deploy block. */
export const deployment99801 = {
  startBlock: 26841592,
  deployTx: "0xe60b64d6c5833694b00747e93ca51f37bf6c137876ad2b580be5c19e1e568609",
  explorerTxTemplate: "https://explorer-elysium-testnet.t.conduit.xyz/tx/{hash}",
  poolManager: "0x909d8c900cba8331765Beb86E3a797C52F1AfF8b",
  positionManager: "0xB5aE0641Ff3C92fFaa372C95F7601B22a7695E4B",
  stateView: "0x687e17A3fC4d8249c925c4e1227b80f7923E8563",
  quoter: "0xa593D471B08aE5CEaB7b07Db73Ab4DA40aD02CaD",
  router: "0x6b9eE0bD2b6c4b87eb867Cd002b3fA516242F08f",
  timelock: "0xA621932b07c7937a7485A0279b782Aed705c9aEC",
  roles: "0xD216773D56d75fb04162C31c463B9a0344F58d25",
  launchTokenImplementation: "0xE08cb8a98b9CeDaAF2Ed87198A4Fc2C3928D1E14",
  feeVault: "0xbF60378Ff1401843A9bb0f8a9E0aBEB169F8b2B0",
  buybackExecutor: "0x7cF314a9d99C52Db6D6045FA5ad7A0332537928B",
  kickbackDistributor: "0xB023F3b7D35420d98fB205C0B96BC25Ed3e60a0E",
  hook: "0x2FD55b6d1fAe64f156CF6e14b03775B1F781e8cC",
  locker: "0xEABd49AFDf43543eB4a7B299a7a9a09ec617C3FE",
  launcher: "0x06FF3B385c7a258a3f46390Cf9Ce4DFeAFFC7870",
  keeper: "0x6071b00861a449dfA741055F1E54343DDf7C1a42",
} as const;

export const pins = {
  v4Core: "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
  v4Periphery: "c6e4754dab11bd38c6f08ac51c3c868569e93d64",
} as const;

export type Mode = "keep" | "kickback" | "burn";
