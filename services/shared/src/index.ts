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
  startBlock: 26803633,
  deployTx: "0xe8f763ae3146d0c59b3acf7b184411bd50a9f3d102e0bd79b990211647c6cb73",
  explorerTxTemplate: "https://explorer-elysium-testnet.t.conduit.xyz/tx/{hash}",
  poolManager: "0x41776AAa3441ED4C80F02BF97E48160fB0277746",
  positionManager: "0x989005D685115B80cdE348829914Ae7431264f8E",
  stateView: "0x0F99A9df2A94695934fdF753f2309A633651FcaE",
  quoter: "0x73FAC4Fa0b0300eA98F464DFC175CA882Ec00ea6",
  router: "0x2051f1087D1E5B427071dce49f64c413902C900E",
  timelock: "0x4A2C5fcdbba47D190c7433b341c0Fca4522a0B24",
  roles: "0xB33bb6b7064b1A49500c3CD303829A8Aab453bec",
  launchTokenImplementation: "0x1cB5CF6d7EBa7a917819113178aff4cD25142857",
  feeVault: "0xb118257EEa9Cf1545DB92fBB3D6b64098a8253F0",
  buybackExecutor: "0x3999C34854d12E0E12bc3179559202Cb48D7c78D",
  kickbackDistributor: "0xDc5312c71313C01569865FFC30Bd3ba15a4B22Db",
  hook: "0x11250C2cD56d4E37a3f8390570A99703848768cC",
  locker: "0xe3948C5B91Fa259BBb1c625b567Da8517b865dc3",
  launcher: "0xCe7F2E8d1B5e8B62f5a9FE81107f60992d97FdfB",
  keeper: "0x6071b00861a449dfA741055F1E54343DDf7C1a42",
} as const;

export const pins = {
  v4Core: "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
  v4Periphery: "c6e4754dab11bd38c6f08ac51c3c868569e93d64",
} as const;

export type Mode = "keep" | "kickback" | "burn";
