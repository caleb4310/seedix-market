import pg from "pg";
import { configuredChainId, elysiumTestnet, pins, requiredAddress } from "@seedix/shared";
import { loadDeployment } from "./deployment.ts";
import type { Hex } from "./hex.ts";
import { isAddress } from "./hex.ts";
import { migrate } from "./migrate.ts";
import { pollOnce, publicClient, type IndexerConfig } from "./poll.ts";
import { PgStore } from "./store.ts";

function envValue(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : fallback;
}

function envAddress(name: string, fallback: string): Hex {
  const value = envValue(name, fallback);
  if (!isAddress(value)) throw new Error(`${name} is not an address`);
  return value;
}

const deployment = loadDeployment();

export function loadIndexerConfig(): IndexerConfig & { databaseUrl: string; pollMs: number; v4Core: string } { return {
  chainId: configuredChainId(),
  rpcUrl: process.env.RPC_URL && process.env.RPC_URL.length > 0 ? process.env.RPC_URL : elysiumTestnet.rpcUrls[0],
  v4Core: pins.v4Core,
  databaseUrl: process.env.DATABASE_URL ?? "",
  pollMs: Number(envValue("INDEXER_POLL_MS", "12000")),
  confirmations: BigInt(envValue("INDEXER_CONFIRMATIONS", "12")),
  startBlock: (() => {
    const raw = process.env.INDEXER_START_BLOCK;
    if (raw && raw.length > 0) return BigInt(raw);
    if (configuredChainId() === 99801) return BigInt(deployment.startBlock);
    throw new Error("INDEXER_START_BLOCK is required");
  })(),
  launcher: requiredAddress("LAUNCHER_ADDRESS"),
  hook: requiredAddress("HOOK_ADDRESS"),
  poolManager: requiredAddress("POOL_MANAGER_ADDRESS"),
  buybackExecutor: requiredAddress("BUYBACK_EXECUTOR"),
  kickbackDistributor: requiredAddress("KICKBACK_DISTRIBUTOR"),
  metadata:
    process.env.METADATA_ADDRESS && isAddress(process.env.METADATA_ADDRESS)
      ? (process.env.METADATA_ADDRESS as Hex)
      : isAddress(deployment.metadata)
        ? (deployment.metadata as Hex)
        : undefined,
}; }

export async function main(): Promise<void> {
  let indexerConfig: ReturnType<typeof loadIndexerConfig>;
  try {
    indexerConfig = loadIndexerConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : "indexer config");
    return;
  }
  if (!indexerConfig.databaseUrl) {
    console.log("indexer: set DATABASE_URL to the host launchpad database");
    return;
  }
  const client = new pg.Client({ connectionString: indexerConfig.databaseUrl });
  await client.connect();
  await migrate(client);
  const store = new PgStore(client);
  const chain = publicClient(indexerConfig.rpcUrl, indexerConfig.chainId);
  console.log(`indexer watching chain ${indexerConfig.chainId} from block ${indexerConfig.startBlock}`);
  for (;;) {
    try {
      await pollOnce(chain, store, indexerConfig);
    } catch (err) {
      console.error("indexer poll failed", err instanceof Error ? err.message : "unknown error");
    }
    await new Promise((resolve) => setTimeout(resolve, indexerConfig.pollMs));
  }
}

if (process.argv[1]?.endsWith("index.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "indexer failed");
    process.exitCode = 1;
  });
}
