import file from "../../../deployments/99801.json" with { type: "json" };

export type Address = `0x${string}`;

function envAddress(name: string, fallback: string): Address {
  const value = process.env[name];
  if (value && /^0x[0-9a-fA-F]{40}$/.test(value)) return value as Address;
  return fallback as Address;
}

function optionalAddress(name: string, fallback: string | undefined): Address | undefined {
  const value = process.env[name] || fallback || "";
  if (/^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value)) return value as Address;
  return undefined;
}

/** Live deployment. A redeploy updates deployments/99801.json. Env overrides are for a local fork. */
export const deployment = file;

export const routerAddress = envAddress("NEXT_PUBLIC_ROUTER", file.contracts.seedixRouter);
export const quoterAddress = envAddress("NEXT_PUBLIC_QUOTER", file.contracts.v4Quoter);
export const stateViewAddress = envAddress("NEXT_PUBLIC_STATE_VIEW", file.contracts.stateView);
export const launcherAddress = envAddress("NEXT_PUBLIC_LAUNCHER", file.contracts.launcher);
export const hookAddress = envAddress("NEXT_PUBLIC_HOOK", file.contracts.launchHook);
export const kickbackAddress = envAddress("NEXT_PUBLIC_KICKBACK", file.contracts.kickbackDistributor);
export const whypeAddress = envAddress("NEXT_PUBLIC_WHYPE", file.tokens.whype);

const contractRecord = file.contracts as Record<string, string>;
export const coinMetadataAddress = optionalAddress("NEXT_PUBLIC_COIN_METADATA", contractRecord.coinMetadata);
export const feeWallet = file.accounts.feeWallet as Address;
const startOverride = process.env.NEXT_PUBLIC_INDEXER_START_BLOCK;
export const indexerStartBlock = startOverride && /^\d+$/.test(startOverride) ? BigInt(startOverride) : BigInt(file.startBlock);

const pairKeys = ["whype", "usdc", "wNVDAx", "wSPYx", "wQQQx", "wMUx", "wSKHYx"] as const;

const pairLabels: Record<(typeof pairKeys)[number], string> = {
  whype: "WHYPE",
  usdc: "USDC",
  wNVDAx: "wNVDAx",
  wSPYx: "wSPYx",
  wQQQx: "wQQQx",
  wMUx: "wMUx",
  wSKHYx: "wSKHYx",
};

export const pairChoices = pairKeys.map((key) => ({
  label: pairLabels[key],
  address: file.tokens[key] as Address,
}));

export function pairByLabel(label: string): Address | undefined {
  return pairChoices.find((item) => item.label === label)?.address;
}

export function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function explorerTx(hash: string): string {
  const template = process.env.NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE || file.explorerTxTemplate;
  return template.replaceAll("{hash}", hash);
}

export function explorerOrigin(): string {
  return (process.env.NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE || file.explorerTxTemplate).replace(/\/tx\/\{hash\}$/, "");
}
