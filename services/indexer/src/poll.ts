import { createPublicClient, defineChain, http, parseAbiItem, type AbiEvent, type PublicClient } from "viem";
import { elysiumTestnet } from "@seedix/shared";
import type { Hex } from "./hex.ts";
import { lower } from "./hex.ts";
import { ingest, type RawLog, type Readers } from "./ingest.ts";
import { confirmedTip, nextRange } from "./price.ts";
import type { Store } from "./store.ts";

const chain = defineChain({
  id: elysiumTestnet.id,
  name: elysiumTestnet.name,
  nativeCurrency: { ...elysiumTestnet.nativeCurrency },
  rpcUrls: { default: { http: [...elysiumTestnet.rpcUrls] } },
});

const eventAbi = {
  CoinLaunched: parseAbiItem(
    "event CoinLaunched(bytes32 indexed poolId, address indexed coin, address indexed pair, uint8 mode, bool isPlatform, address feeRecipient, address teamWallet, uint256 teamAmount, uint256 startMcap)",
  ),
  CoinLaunchedV2: parseAbiItem(
    "event CoinLaunched(bytes32 indexed poolId, address indexed coin, address indexed pair, uint8 mode, bool isPlatform, address feeRecipient, address teamWallet, uint256 teamAmount, uint256 startMcap, uint8 category, uint8 pairStatus)",
  ),
  CoinLaunchedV3: parseAbiItem(
    "event CoinLaunched(bytes32 indexed poolId, address indexed coin, address indexed pair, uint8 mode, bool isPlatform, address feeRecipient, address teamWallet, uint256 teamAmount, uint256 startMcap, uint8 category, uint8 pairStatus, address backing)",
  ),
  PairClassified: parseAbiItem("event PairClassified(address indexed pair, uint8 status, uint8 category)"),
  MetadataPinned: parseAbiItem("event MetadataPinned(bytes32 indexed poolId, address indexed creator, string cid)"),
  Swap: parseAbiItem(
    "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
  ),
  FeesTaken: parseAbiItem(
    "event FeesTaken(bytes32 indexed poolId, address indexed sender, bool pairSide, uint24 hookFeePips, uint256 hookAmt, uint256 platformAmt)",
  ),
  BuybackExecuted: parseAbiItem("event BuybackExecuted(bytes32 indexed poolId, uint256 amountIn, uint256 coinBurned)"),
  KickbackFunded: parseAbiItem("event KickbackFunded(bytes32 indexed poolId, uint64 indexed epoch, uint256 amount)"),
  RootPosted: parseAbiItem(
    "event RootPosted(bytes32 indexed poolId, uint64 indexed epoch, bytes32 root, bytes32 manifestHash)",
  ),
  KickbackCancelled: parseAbiItem("event KickbackCancelled(bytes32 indexed poolId, uint64 indexed epoch, uint256 refunded)"),
  KickbackClaimed: parseAbiItem(
    "event KickbackClaimed(bytes32 indexed poolId, uint64 indexed epoch, address account, uint256 amount)",
  ),
  RolloverApplied: parseAbiItem("event RolloverApplied(bytes32 indexed poolId, uint64 indexed epoch, uint256 amount)"),
  Pushed: parseAbiItem("event Pushed(bytes32 indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount)"),
  Rolled: parseAbiItem("event Rolled(bytes32 indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount)"),
  ClaimableCredited: parseAbiItem(
    "event ClaimableCredited(bytes32 indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount)",
  ),
  FailedPull: parseAbiItem(
    "event FailedPull(bytes32 indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount)",
  ),
  GasReimbursed: parseAbiItem(
    "event GasReimbursed(bytes32 indexed poolId, uint64 indexed epoch, address indexed keeper, uint256 amount)",
  ),
  RoundSealed: parseAbiItem("event RoundSealed(bytes32 indexed poolId, uint64 indexed epoch, uint256 rolled)"),
  Transfer: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 amount)"),
} as const;

const configAbi = parseAbiItem(
  "function config(bytes32) view returns (address coin, address pair, bool coinIsToken0, uint8 mode, bool isPlatform, uint40 launchTime, address feeRecipient)",
);
const nameAbi = parseAbiItem("function name() view returns (string)");
const symbolAbi = parseAbiItem("function symbol() view returns (string)");
const decimalsAbi = parseAbiItem("function decimals() view returns (uint8)");
const epochAbi = parseAbiItem(
  "function epochs(bytes32,uint64) view returns (uint128 funded, uint128 claimed, uint64 start, uint64 end, uint64 postedAt, bytes32 root, bytes32 manifestHash, bool cancelled)",
);

export type IndexerConfig = {
  chainId: number;
  rpcUrl: string;
  startBlock: bigint;
  confirmations: bigint;
  launcher: Hex;
  hook: Hex;
  poolManager: Hex;
  buybackExecutor: Hex;
  kickbackDistributor: Hex;
  metadata?: Hex;
};

function pick(value: unknown, index: number, name: string): unknown {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (name in record) return record[name];
    if (String(index) in record) return record[index];
  }
  throw new Error(`missing ${name}`);
}

async function pull(
  client: PublicClient,
  address: Hex | Hex[],
  event: AbiEvent,
  eventName: string,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawLog[]> {
  if (Array.isArray(address) && address.length === 0) return [];
  const logs = await client.getLogs({ address, event, fromBlock, toBlock });
  return logs.flatMap((log) => {
    if (log.blockNumber == null || log.logIndex == null || log.transactionHash == null) return [];
    return [
      {
        address: log.address,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
        eventName,
        args: { ...(log.args as Record<string, unknown>) },
      },
    ];
  });
}

function readers(client: PublicClient, hook: Hex, distributor: Hex): Readers {
  const times = new Map<string, number>();
  return {
    async blockTime(blockNumber) {
      const key = blockNumber.toString();
      const cached = times.get(key);
      if (cached !== undefined) return cached;
      const block = await client.getBlock({ blockNumber });
      const time = Number(block.timestamp);
      times.set(key, time);
      return time;
    },
    async coinMeta(coin, pair, poolId) {
      const [config, name, symbol, pairSymbol, coinDecimals, pairDecimals] = await Promise.all([
        client.readContract({ address: hook, abi: [configAbi], functionName: "config", args: [poolId] }),
        client.readContract({ address: coin, abi: [nameAbi], functionName: "name" }),
        client.readContract({ address: coin, abi: [symbolAbi], functionName: "symbol" }),
        client.readContract({ address: pair, abi: [symbolAbi], functionName: "symbol" }),
        client.readContract({ address: coin, abi: [decimalsAbi], functionName: "decimals" }),
        client.readContract({ address: pair, abi: [decimalsAbi], functionName: "decimals" }),
      ]);
      return {
        name: String(name),
        symbol: String(symbol),
        pairSymbol: String(pairSymbol),
        coinDecimals: Number(coinDecimals),
        pairDecimals: Number(pairDecimals),
        coinIsToken0: Boolean(pick(config, 2, "coinIsToken0")),
        launchTime: Number(pick(config, 5, "launchTime")),
      };
    },
    async epochWindow(poolId, epoch) {
      try {
        const epochRow = await client.readContract({
          address: distributor,
          abi: [epochAbi],
          functionName: "epochs",
          args: [poolId, epoch],
        });
        return { start: Number(pick(epochRow, 2, "start")), end: Number(pick(epochRow, 3, "end")) };
      } catch {
        return null;
      }
    },
    async readMetadata(cid) {
      if (!/^[A-Za-z0-9]{10,128}$/.test(cid)) return null;
      const gateway = process.env.IPFS_GATEWAY ?? "http://127.0.0.1:18486";
      try {
        const response = await fetch(`${gateway}/ipfs/${cid}`);
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    },
  };
}

export async function pollOnce(client: PublicClient, store: Store, cfg: IndexerConfig): Promise<void> {
  const head = await client.getBlockNumber();
  const safe = confirmedTip(head, cfg.confirmations);
  if (safe === null) return;
  const cursor = await store.getCursor(cfg.chainId);
  const range = nextRange(cursor, cfg.startBlock, safe);
  if (!range) return;
  await store.tx(async (txStore) => {
    if (cursor !== null && range.from <= cursor) await txStore.forgetFrom(cfg.chainId, range.from);
    const known = await txStore.listCoins(cfg.chainId);
    const tokens = [...new Set(known.map((coin) => coin.coin))];
    const sources: Array<Promise<RawLog[]>> = [
      pull(client, cfg.launcher, eventAbi.CoinLaunched, "CoinLaunched", range.from, range.to),
      pull(client, cfg.launcher, eventAbi.CoinLaunchedV2, "CoinLaunched", range.from, range.to),
      pull(client, cfg.launcher, eventAbi.CoinLaunchedV3, "CoinLaunched", range.from, range.to),
      pull(client, cfg.launcher, eventAbi.PairClassified, "PairClassified", range.from, range.to),
      ...(cfg.metadata
        ? [pull(client, cfg.metadata, eventAbi.MetadataPinned, "MetadataPinned", range.from, range.to)]
        : []),
      pull(client, cfg.hook, eventAbi.FeesTaken, "FeesTaken", range.from, range.to),
      pull(client, cfg.poolManager, eventAbi.Swap, "Swap", range.from, range.to),
      pull(client, cfg.buybackExecutor, eventAbi.BuybackExecuted, "BuybackExecuted", range.from, range.to),
    ];
    for (const [name, abi] of Object.entries(eventAbi)) {
      if (
        name === "CoinLaunched" ||
        name === "CoinLaunchedV2" ||
        name === "CoinLaunchedV3" ||
        name === "PairClassified" ||
        name === "MetadataPinned" ||
        name === "FeesTaken" ||
        name === "Swap" ||
        name === "BuybackExecuted" ||
        name === "Transfer"
      ) {
        continue;
      }
      sources.push(pull(client, cfg.kickbackDistributor, abi as AbiEvent, name, range.from, range.to));
    }
    for (let i = 0; i < tokens.length; i += 20) {
      sources.push(pull(client, tokens.slice(i, i + 20), eventAbi.Transfer, "Transfer", range.from, range.to));
    }
    const logs = (await Promise.all(sources)).flat();
    await ingest(txStore, cfg.chainId, logs, readers(client, cfg.hook, cfg.kickbackDistributor));
    const launched = logs
      .filter((log) => log.eventName === "CoinLaunched")
      .map((log) => String(log.args.coin) as Hex);
    const fresh = launched.filter((token) => !tokens.some((knownToken) => lower(knownToken) === lower(token)));
    if (fresh.length > 0) {
      const transfers = await pull(client, fresh as Hex[], eventAbi.Transfer, "Transfer", range.from, range.to);
      await ingest(txStore, cfg.chainId, transfers, readers(client, cfg.hook, cfg.kickbackDistributor));
    }
    await txStore.setCursor(cfg.chainId, range.to);
  });
}

export function publicClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain, transport: http(rpcUrl) });
}
