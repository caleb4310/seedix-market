export {
  activeChain,
  baseSepolia,
  elysiumMainnet,
  elysiumTestnet,
  presetFor,
  type ActiveChain,
} from "./chains.ts";

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
  startBlock: 27707424,
  deployTx: "0xe555dda95ebb333425507b33929b8998e466f988248654ba367b0a7043a68736",
  explorerTxTemplate: "https://explorer-elysium-testnet.t.conduit.xyz/tx/{hash}",
  poolManager: "0x5002D9D837624a7DaA835fd48271A81bef793F8d",
  positionManager: "0x409dbA5498cC6436290E93996427986D8D0dFABd",
  stateView: "0x9b0C7865d4b5F88Fd41285BFcdf31d022bcC93a7",
  quoter: "0x9922D73A8d7165D3227bAd13223f9eb9A1bcb4C3",
  router: "0xCf19b436d22FB8b8BEEdb9DABC564E983f7f05dA",
  timelock: "0xcFcf97e9B76a1191C802b8704D423c18560a85C1",
  roles: "0x49f6268C346b16A853e09e040A6f11e53C41Fc1A",
  launchTokenImplementation: "0xD51d533A9914002AB0a7f87233c9ee4f7D3f0D08",
  feeVault: "0xe4C8900893dc8A07131e34f04b505a6f20d497B3",
  buybackExecutor: "0x31177F01f3FB83693AeCD61cf6818686A0d0682d",
  kickbackDistributor: "0x1E7aB5525a15a7949c3C0fDd1a0989bAD3124860",
  hook: "0x39EB6bE62A613723C42Bf633553bC70B636328cC",
  locker: "0x60C15a67a9c575dba0f9248E6cf090E96CB0ca3F",
  launcher: "0x9cDffE00cdbd6596B423e6CCEd9560994F88EC2d",
  keeper: "0x6071b00861a449dfA741055F1E54343DDf7C1a42",
  publisher: "0x6071b00861a449dfA741055F1E54343DDf7C1a42",
} as const;

export { capTransactionFees, priorityFloorWei, PRIORITY_FLOOR_WEI, transactionFees, type Eip1559Fees, type LegacyFees, type TxFees } from "./fees.ts";

export const pins = {
  v4Core: "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
  v4Periphery: "c6e4754dab11bd38c6f08ac51c3c868569e93d64",
} as const;

export type Mode = "keep" | "kickback" | "burn";

export { coinPrice, formatRatio, LAUNCH_SUPPLY, marketCapFromSpot } from "./spot.ts";
export {
  cleanDescription,
  cleanSocials,
  httpsUrl,
  stripControls,
  telegramUrl,
  xUrl,
  type Socials,
} from "./metadata.ts";
export {
  MAX_CREATOR_TAX_BPS,
  MAX_EFFECTIVE_TAX_BPS,
  PROTOCOL_FEE_BPS,
  creatorBpsFromPercent,
  formatTaxBps,
  reportedZroTax,
  zroFeeMode,
  zroTaxLabel,
  type ZroFeeMode,
  type ZroTax,
} from "./zroTax.ts";
export {
  LOGO_EXPIRY_SECONDS,
  LOGO_MAX_BYTES,
  LOGO_RATE_LIMIT,
  LOGO_RATE_WINDOW_MS,
  logoAttachTypes,
  logoDomainName,
  logoUploadTypes,
} from "./logoMessage.ts";
