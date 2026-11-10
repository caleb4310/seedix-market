import type { AbiEvent, Address, Hex, PublicClient } from "viem";
import { marketCapFromRaw, marketCapUsd } from "./amounts";
import { coinPrice, LAUNCH_SUPPLY, marketCapFromSpot } from "@seedix/shared";
import { erc20Abi, hookConfigAbi, launcherAbi, metadataAbi } from "./abi";
import type { Coin, Mode } from "./coin";
import { coinMetadataAddress, hookAddress, indexerStartBlock, launcherAddress, stateViewAddress } from "./deployment";

const poolIdPattern = /^0x[0-9a-fA-F]{64}$/;
const zero = /^0x0{40}$/i;

const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

export type LaunchedRead = {
  coin: Address;
  pair: Address;
  mode: number;
  isPlatform: boolean;
  launchTime: number;
  feeRecipient: Address;
  name: string;
  symbol: string;
  pairSymbol: string;
  pairDecimals: number;
  coinIsToken0: boolean;
  startMcap: bigint | null;
  sqrtPriceX96?: bigint | null;
  supplyRaw?: bigint | null;
  metadataCid: string | null;
  poolLive: boolean;
  category: Coin["category"];
};

function modeOf(value: number): Mode {
  if (value === 1) return "kickback";
  if (value === 2) return "burn";
  return "keep";
}

function categoryOf(value: number): Coin["category"] {
  if (value === 1) return "stock";
  if (value === 2) return "preipo";
  return "crypto";
}

/** A launched coin from hook config, the launch log, CoinMetadata, and StateView. */
export function coinFromLaunch(id: string, read: LaunchedRead): Coin | null {
  if (!poolIdPattern.test(id) || zero.test(read.coin)) return null;
  const now = Math.floor(Date.now() / 1000);
  const mode = modeOf(read.mode);
  const pairName = read.pairSymbol.trim() || "PAIR";
  const startMcap = read.startMcap === null ? undefined : marketCapFromRaw(read.startMcap, read.pairDecimals);
  const supply = read.supplyRaw && read.supplyRaw > 0n ? read.supplyRaw : LAUNCH_SUPPLY;
  const liveText = read.sqrtPriceX96 && read.sqrtPriceX96 > 0n
    ? marketCapFromSpot(coinPrice(read.sqrtPriceX96, read.coinIsToken0), supply, read.pairDecimals)
    : null;
  const mcap = liveText == null ? undefined : Number(liveText);
  return {
    id,
    name: read.name.trim() || "Coin",
    ticker: read.symbol.trim() || "COIN",
    pair: pairName,
    mode,
    ageSec: Math.max(0, now - read.launchTime),
    launchTime: read.launchTime,
    description: read.isPlatform ? "Platform token." : `${mode} mode, paired with ${pairName}.`,
    recipient: read.feeRecipient,
    mcap: mcap !== undefined && Number.isFinite(mcap) ? mcap : undefined,
    startMcap,
    mcapUsd: marketCapUsd(mcap !== undefined && Number.isFinite(mcap) ? mcap : undefined, null),
    coinIsToken0: read.coinIsToken0,
    pairDecimals: read.pairDecimals,
    category: read.category,
    tokenAddress: read.coin,
    pairAddress: read.pair,
    hooks: hookAddress,
    poolId: id as Hex,
  };
}

async function readString(client: PublicClient, token: Address, functionName: "name" | "symbol"): Promise<string> {
  try {
    const value = await client.readContract({ address: token, abi: erc20Abi, functionName });
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** Reads a coin that the indexer has not stored yet. Null means the hook has no such pool. */
export async function readLaunchedCoin(client: PublicClient, id: string): Promise<Coin | null> {
  if (!poolIdPattern.test(id) || !hookAddress || !launcherAddress) return null;
  const poolId = id as Hex;
  let config: readonly unknown[];
  try {
    config = (await client.readContract({
      address: hookAddress,
      abi: hookConfigAbi,
      functionName: "config",
      args: [poolId],
    })) as readonly unknown[];
  } catch {
    throw new Error("The network request failed. Check the RPC and try again.");
  }
  const coin = config[0] as Address;
  const pair = config[1] as Address;
  if (!coin || zero.test(coin) || !pair) return null;
  const coinIsToken0 = Boolean(config[2]);
  const mode = Number(config[3] ?? 0);
  const isPlatform = Boolean(config[4]);
  const launchTime = Number(config[5] ?? 0);
  const feeRecipient = (config[6] as Address) ?? coin;

  const [name, symbol, pairSymbol, pairDecimals, metadataCid, sqrtPriceX96, supplyRaw] = await Promise.all([
    readString(client, coin, "name"),
    readString(client, coin, "symbol"),
    readString(client, pair, "symbol"),
    client
      .readContract({ address: pair, abi: erc20Abi, functionName: "decimals" })
      .then((value) => Number(value))
      .catch(() => 18),
    coinMetadataAddress
      ? client
          .readContract({ address: coinMetadataAddress, abi: metadataAbi, functionName: "cidOf", args: [poolId] })
          .then((value) => (typeof value === "string" && value.length > 0 ? value : null))
          .catch(() => null)
      : Promise.resolve(null),
    stateViewAddress
      ? client
          .readContract({ address: stateViewAddress, abi: stateViewAbi, functionName: "getSlot0", args: [poolId] })
          .then((value) => {
            const sqrt = Array.isArray(value) ? value[0] : (value as { sqrtPriceX96?: bigint }).sqrtPriceX96;
            return typeof sqrt === "bigint" && sqrt > 0n ? sqrt : null;
          })
          .catch(() => null)
      : Promise.resolve(null),
    client
      .readContract({ address: coin, abi: erc20Abi, functionName: "totalSupply" })
      .then((value) => (typeof value === "bigint" && value > 0n ? value : LAUNCH_SUPPLY))
      .catch(() => LAUNCH_SUPPLY),
  ]);
  const launchedEvent = launcherAbi.find((item): item is AbiEvent => item.type === "event" && item.name === "CoinLaunched");
  const start = launchedEvent
    ? await client
        .getLogs({
          address: launcherAddress,
          event: launchedEvent,
          args: { poolId },
          fromBlock: indexerStartBlock,
          toBlock: "latest",
        })
        .then((logs) => logs[0])
        .catch(() => undefined)
    : undefined;
  const args = (start as { args?: { startMcap?: bigint; category?: number } } | undefined)?.args;
  const category = categoryOf(Number(args?.category ?? 0));
  void metadataCid;

  const built = coinFromLaunch(id, {
    coin,
    pair,
    mode,
    isPlatform,
    launchTime,
    feeRecipient,
    name,
    symbol,
    pairSymbol,
    pairDecimals: Number.isInteger(pairDecimals) ? pairDecimals : 18,
    coinIsToken0,
    startMcap: typeof args?.startMcap === "bigint" ? args.startMcap : null,
    sqrtPriceX96,
    supplyRaw,
    metadataCid,
    poolLive: sqrtPriceX96 !== null,
    category,
  });
  return built;
}
