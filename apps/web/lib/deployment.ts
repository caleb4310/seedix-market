import baseFile from "../../../deployments/base-sepolia.json" with { type: "json" };
import elysiumFile from "../../../deployments/99801.json" with { type: "json" };

export type Address = `0x${string}`;

type DeploymentJson = {
  chainId?: number;
  name?: string;
  startBlock?: number;
  rpcUrl?: string;
  explorerTxTemplate?: string;
  contracts: Record<string, string | undefined>;
  tokens: Record<string, string | undefined>;
  accounts?: { feeWallet?: string };
};

function envAddress(name: string, fallback: string | undefined): Address {
  const value = process.env[name];
  if (value && /^0x[0-9a-fA-F]{40}$/.test(value)) return value as Address;
  if (fallback && /^0x[0-9a-fA-F]{40}$/.test(fallback)) return fallback as Address;
  throw new Error(`${name} is not configured`);
}

function optionalAddress(name: string, fallback: string | undefined): Address | undefined {
  const value = process.env[name] || fallback || "";
  if (/^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value)) return value as Address;
  return undefined;
}

export function selectedChainId(): number {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID || process.env.CHAIN_ID || "84532";
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 84532;
}

function selectedFile(): DeploymentJson {
  return selectedChainId() === 99801 ? (elysiumFile as DeploymentJson) : (baseFile as DeploymentJson);
}

/** Live deployment for the selected chain. Env overrides are for a local fork. */
export const deployment = selectedFile();

const contracts = deployment.contracts;
const tokens = deployment.tokens;

export const routerAddress = envAddress("NEXT_PUBLIC_ROUTER", contracts.seedixRouter);
export const quoterAddress = envAddress("NEXT_PUBLIC_QUOTER", contracts.v4Quoter);
export const stateViewAddress = envAddress("NEXT_PUBLIC_STATE_VIEW", contracts.stateView);
export const launcherAddress = envAddress("NEXT_PUBLIC_LAUNCHER", contracts.launcher);
export const hookAddress = envAddress("NEXT_PUBLIC_HOOK", contracts.launchHook);
export const kickbackAddress = envAddress("NEXT_PUBLIC_KICKBACK", contracts.kickbackDistributor);
export const whypeAddress = envAddress("NEXT_PUBLIC_WETH", tokens.weth || tokens.whype);
export const wrappedNativeAddress = whypeAddress;

export const coinMetadataAddress = optionalAddress("NEXT_PUBLIC_COIN_METADATA", contracts.coinMetadata);
export const feeWallet = (deployment.accounts?.feeWallet ?? "0x0000000000000000000000000000000000000000") as Address;
const startOverride = process.env.NEXT_PUBLIC_INDEXER_START_BLOCK;
export const indexerStartBlock =
  startOverride && /^\d+$/.test(startOverride) ? BigInt(startOverride) : BigInt(deployment.startBlock ?? 0);

const pairLabels: Record<string, string> = {
  whype: "WHYPE",
  weth: "WETH",
  mockZro: "ZRO",
  usdc: "USDC",
  wNVDAx: "wNVDAx",
  wSPYx: "wSPYx",
  wQQQx: "wQQQx",
  wMUx: "wMUx",
  wSKHYx: "wSKHYx",
};

export const pairChoices = Object.entries(tokens)
  .filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^0x[0-9a-fA-F]{40}$/.test(entry[1]))
  .map(([key, address]) => ({ label: pairLabels[key] ?? key, address: address as Address }));

export function pairByLabel(label: string): Address | undefined {
  return pairChoices.find((item) => item.label === label)?.address;
}

export function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function explorerTx(hash: string): string {
  const template = process.env.NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE || deployment.explorerTxTemplate || "";
  return template.replaceAll("{hash}", hash);
}

export function explorerOrigin(): string {
  return (process.env.NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE || deployment.explorerTxTemplate || "").replace(/\/tx\/\{hash\}$/, "");
}

export function explorerAddress(address: string): string {
  const addressTemplate = process.env.NEXT_PUBLIC_EXPLORER_ADDRESS_URL_TEMPLATE;
  if (addressTemplate) return addressTemplate.replaceAll("{address}", address);
  return `${explorerOrigin()}/address/${address}`;
}

export const executorAddress = envAddress("NEXT_PUBLIC_EXECUTOR", contracts.buybackExecutor);
