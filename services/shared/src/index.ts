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
  startBlock: 27047311,
  deployTx: "0x9b91025ed3547f019f7e7481ce7f9d7f8f0cb166fc46febbf04b2931cb38553b",
  explorerTxTemplate: "https://explorer-elysium-testnet.t.conduit.xyz/tx/{hash}",
  poolManager: "0x82C6E26D3eb5d9955b538dABE3C71b2c3c878c09",
  positionManager: "0x18964274A4352815D87A0C2388B6a67DA531F697",
  stateView: "0x667cb2cDB37C6c9328D1096Ed51b1Fd6136cb1aA",
  quoter: "0xD74E39d881E47d153FBB767CAa68140DbF35b3Bd",
  router: "0xaC65DD1fAAbA63A18ADC609F6b53dfAB879Bb8C3",
  timelock: "0xaFfb60AF1e2120dE60B0C9Ed51798838Ee4D2365",
  roles: "0x1298871Cd58Ac8348289DcC323EEA7cdD4c4E388",
  launchTokenImplementation: "0xB6A99d523eEEf62A53597F31eBeCd097A2fFCf97",
  feeVault: "0xb5F4ADac7975955859FB7ce334c4dA6beB2F8Cc5",
  buybackExecutor: "0xfdb16Fa1Dd6c2fF7980e8323De5085F497F67366",
  kickbackDistributor: "0xd00eb7114f8aF86b52393893E92559308df50372",
  hook: "0x6cf82a15C0405475552f1839DA26D964ec19a8Cc",
  locker: "0xBa48334AE8cC9Fe2731c4535a7e20B09cd7F8119",
  launcher: "0xeDE448d4325763C7CcBaae75FcdCC6cC6b75fc3e",
  keeper: "0x6071b00861a449dfA741055F1E54343DDf7C1a42",
} as const;

export { configuredChainId, requiredAddress } from "./config.ts";

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
  LOGO_EXPIRY_SECONDS,
  LOGO_MAX_BYTES,
  LOGO_RATE_LIMIT,
  LOGO_RATE_WINDOW_MS,
  logoAttachTypes,
  logoDomainName,
  logoUploadTypes,
} from "./logoMessage.ts";
