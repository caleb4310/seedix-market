import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { elysiumTestnet } from "@seedix/shared";
import { deployment99801 } from "./deployment.ts";
import { assertKeyFile, keyFilePath, loadKey } from "./key.ts";
import { preparePush, type Manifest } from "./merkle.ts";
import { feeWithinCap, planCoinBuyback, planPlatformBuyback, pushBatches, pushReady } from "./plan.ts";

const chain = defineChain({
  id: elysiumTestnet.id,
  name: elysiumTestnet.name,
  nativeCurrency: { ...elysiumTestnet.nativeCurrency },
  rpcUrls: { default: { http: [...elysiumTestnet.rpcUrls] } },
});

const executorAbi = parseAbi([
  "function buybackCoin(bytes32 id, uint256 amountIn, uint256 minOut) returns (uint256)",
  "function buybackPlatform(address pair, uint256 amountIn, uint256 minWhypeOut, uint256 minPlatformOut) returns (uint256, uint256)",
  "function lastBuybackAt(bytes32 id) view returns (uint256)",
  "function maxInPerPeriod() view returns (uint256)",
  "function platformPoolId() view returns (bytes32)",
  "function platformSet() view returns (bool)",
]);

const hookAbi = parseAbi([
  "function pools(uint256) view returns (bytes32)",
  "function pots(bytes32) view returns (uint128 creatorPair, uint128 creatorCoin, uint128 kickbackPair, uint128 burnPair, uint128 burnCoin)",
  "function platformBurn(address) view returns (uint256)",
]);

const distributorAbi = parseAbi([
  "function epochs(bytes32,uint64) view returns (uint128 funded, uint128 claimed, uint64 start, uint64 end, uint64 postedAt, bytes32 root, bytes32 manifestHash, bool cancelled)",
  "function push(bytes32 id, uint64 epochId, address[] accounts, uint256[] amounts, bytes32[][] proofs) returns (uint256)",
  "function seal(bytes32 id, uint64 epochId)",
  "function roundClosed(bytes32,uint64) view returns (bool)",
]);

function envAddress(name: string, fallback: string): Address {
  const raw = process.env[name];
  const value = raw && raw.length > 0 ? raw : fallback;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} is not an address`);
  return value as Address;
}

function scrub(err: unknown, key: Hex): string {
  const text = err instanceof Error ? err.message.split("\n")[0] ?? "transaction failed" : "transaction failed";
  return text.replaceAll(key.toLowerCase(), "[key]").replaceAll(key, "[key]");
}

function asHex(value: unknown, index: number, name: string): Hex {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const picked = name in record ? record[name] : record[index];
    if (typeof picked === "string" && picked.startsWith("0x")) return picked as Hex;
  }
  throw new Error(`missing ${name}`);
}

function asBool(value: unknown, index: number, name: string): boolean {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const picked = name in record ? record[name] : record[index];
    if (typeof picked === "boolean") return picked;
  }
  throw new Error(`missing ${name}`);
}

function asRecord(value: unknown, index: number, name: string): bigint {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const picked = name in record ? record[name] : record[index];
    if (typeof picked === "bigint") return picked;
  }
  throw new Error(`missing ${name}`);
}

async function readManifests(dir: string): Promise<Manifest[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Manifest[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const text = await readFile(path.join(dir, name), "utf8");
    const parsed = parseManifest(text);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseManifest(text: string): Manifest | null {
  try {
    const raw = JSON.parse(text) as {
      poolId?: string;
      epoch?: string;
      chainId?: number;
      distributor?: string;
      coin?: string;
      pair?: string;
      claims?: { account?: string; amount?: string }[];
    };
    if (!raw.poolId || !raw.epoch || !raw.distributor || !raw.coin || !raw.pair || !raw.claims?.length) return null;
    return {
      poolId: raw.poolId as Hex,
      epoch: BigInt(raw.epoch),
      chainId: BigInt(raw.chainId ?? elysiumTestnet.id),
      distributor: raw.distributor as Hex,
      coin: raw.coin as Hex,
      pair: raw.pair as Hex,
      claims: raw.claims.map((claim) => ({ account: claim.account as Hex, amount: BigInt(claim.amount ?? "0") })),
    };
  } catch {
    return null;
  }
}

export async function main(): Promise<void> {
  const keyFile = keyFilePath(process.env);
  if (!keyFile) {
    console.log("keeper: set KEEPER_PRIVATE_KEY to a root-only file or a Docker secret path");
    return;
  }
  const info = await stat(keyFile);
  assertKeyFile(keyFile, info.mode, info.uid);
  const key = loadKey(await readFile(keyFile, "utf8"));
  const account = privateKeyToAccount(key);
  const rpc = process.env.RPC_URL && process.env.RPC_URL.length > 0 ? process.env.RPC_URL : elysiumTestnet.rpcUrls[0];
  const hook = envAddress("HOOK_ADDRESS", deployment99801.hook);
  const executor = envAddress("BUYBACK_EXECUTOR", deployment99801.buybackExecutor);
  const distributor = envAddress("KICKBACK_DISTRIBUTOR", deployment99801.kickbackDistributor);
  const pollMs = Number(process.env.KEEPER_POLL_MS ?? 60_000);
  const manifestDir = process.env.KICKBACK_MANIFEST_DIR ?? "";
  const maxFeeGwei = process.env.KEEPER_MAX_FEE_GWEI && process.env.KEEPER_MAX_FEE_GWEI.length > 0 ? process.env.KEEPER_MAX_FEE_GWEI : "100";
  const maxGasRaw = process.env.KEEPER_MAX_GAS && process.env.KEEPER_MAX_GAS.length > 0 ? process.env.KEEPER_MAX_GAS : "12000000";
  const maxFeeCap = BigInt(maxFeeGwei) * 1_000_000_000n;
  const maxGas = BigInt(maxGasRaw);
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  console.log(`keeper ${account.address} on chain ${chain.id}`);

  const metrics = { buybacks: 0, pushes: 0, seals: 0, skips: 0, errors: 0 };

  const send = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[]) => {
    let gas: bigint;
    try {
      gas = await publicClient.estimateContractGas({ account, address, abi, functionName, args });
      await publicClient.simulateContract({ account, address, abi, functionName, args });
    } catch (err) {
      metrics.skips += 1;
      console.log(`skip ${functionName}: ${scrub(err, key)}`);
      return false;
    }
    const fees = await publicClient.estimateFeesPerGas();
    const maxFee = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
    if (!feeWithinCap(gas, maxFee, maxFeeCap, maxGas)) {
      metrics.skips += 1;
      console.log(`skip ${functionName}: gas ${gas} fee ${maxFee} is above the cap`);
      return false;
    }
    const priority = fees.maxPriorityFeePerGas ?? maxFee / 10n;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const hash = await wallet.writeContract({
          address,
          abi,
          functionName,
          args,
          account,
          gas: (gas * 12n) / 10n,
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: priority > maxFee ? maxFee : priority,
        });
        console.log(`${functionName} ${hash}`);
        return true;
      } catch (err) {
        console.error(`send ${functionName} attempt ${attempt} failed: ${scrub(err, key)}`);
        if (attempt === 3) metrics.errors += 1;
        else await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
      }
    }
    return false;
  };

  for (;;) {
    try {
      const cap = await publicClient.readContract({ address: executor, abi: executorAbi, functionName: "maxInPerPeriod" });
      const now = BigInt(Math.floor(Date.now() / 1000));
      const pools: Hex[] = [];
      for (let i = 0; i < 10_000; i += 1) {
        try {
          pools.push(
            await publicClient.readContract({ address: hook, abi: hookAbi, functionName: "pools", args: [BigInt(i)] }),
          );
        } catch {
          break;
        }
      }
      for (const poolId of pools) {
        const pots = await publicClient.readContract({ address: hook, abi: hookAbi, functionName: "pots", args: [poolId] });
        const last = await publicClient.readContract({
          address: executor,
          abi: executorAbi,
          functionName: "lastBuybackAt",
          args: [poolId],
        });
        const steps = planCoinBuyback(asRecord(pots, 3, "burnPair"), cap, last, now);
        for (const amount of steps) {
          try {
            await publicClient.simulateContract({
              account,
              address: executor,
              abi: executorAbi,
              functionName: "buybackCoin",
              args: [poolId, amount, 0n],
            });
            const hash = await wallet.writeContract({
              address: executor,
              abi: executorAbi,
              functionName: "buybackCoin",
              args: [poolId, amount, 0n],
              account,
            });
            console.log(`buybackCoin ${poolId} ${hash}`);
            metrics.buybacks += 1;
            break;
          } catch (err) {
            console.log(`skip buybackCoin ${poolId}: ${scrub(err, key)}`);
          }
        }
      }
      const platformSet = await publicClient.readContract({
        address: executor,
        abi: executorAbi,
        functionName: "platformSet",
      });
      if (platformSet) {
        const platformPool = await publicClient.readContract({
          address: executor,
          abi: executorAbi,
          functionName: "platformPoolId",
        });
        const lastPlatform = await publicClient.readContract({
          address: executor,
          abi: executorAbi,
          functionName: "lastBuybackAt",
          args: [platformPool],
        });
        let sentPlatform = false;
        for (const pair of deployment99801.pairs) {
          if (sentPlatform) break;
          const pot = await publicClient.readContract({
            address: hook,
            abi: hookAbi,
            functionName: "platformBurn",
            args: [pair as Address],
          });
          const steps = planPlatformBuyback(pot, cap, lastPlatform, now);
          for (const amount of steps) {
            try {
              await publicClient.simulateContract({
                account,
                address: executor,
                abi: executorAbi,
                functionName: "buybackPlatform",
                args: [pair as Address, amount, 1n, 1n],
              });
              const hash = await wallet.writeContract({
                address: executor,
                abi: executorAbi,
                functionName: "buybackPlatform",
                args: [pair as Address, amount, 1n, 1n],
                account,
              });
              console.log(`buybackPlatform ${pair} ${hash}`);
              metrics.buybacks += 1;
              sentPlatform = true;
              break;
            } catch (err) {
              console.log(`skip buybackPlatform ${pair}: ${scrub(err, key)}`);
            }
          }
        }
      }
      if (manifestDir) {
        for (const manifest of await readManifests(manifestDir)) {
          const epoch = await publicClient.readContract({
            address: distributor,
            abi: distributorAbi,
            functionName: "epochs",
            args: [manifest.poolId, manifest.epoch],
          });
          const postedAt = asRecord(epoch, 4, "postedAt");
          const root = asHex(epoch, 5, "root");
          const cancelled = asBool(epoch, 7, "cancelled");
          if (!pushReady(postedAt, now, cancelled)) continue;
          const closed = await publicClient.readContract({
            address: distributor,
            abi: distributorAbi,
            functionName: "roundClosed",
            args: [manifest.poolId, manifest.epoch],
          });
          if (closed) continue;
          const prepared = preparePush(manifest, root as Hex);
          if (!prepared) {
            metrics.skips += 1;
            console.log(`skip push ${manifest.poolId} epoch ${manifest.epoch}: root does not match`);
            continue;
          }
          const batches = pushBatches(
            prepared.accounts.map((account, i) => ({
              account,
              amount: prepared.amounts[i] ?? 0n,
              proof: prepared.proofs[i] ?? [],
            })),
          );
          for (const batch of batches) {
            const ok = await send(distributor, distributorAbi, "push", [
              manifest.poolId,
              manifest.epoch,
              batch.map((row) => row.account),
              batch.map((row) => row.amount),
              batch.map((row) => row.proof),
            ]);
            if (ok) metrics.pushes += 1;
          }
          const sealed = await send(distributor, distributorAbi, "seal", [manifest.poolId, manifest.epoch]);
          if (sealed) metrics.seals += 1;
        }
      }
      console.log(
        `keeper poll buybacks=${metrics.buybacks} pushes=${metrics.pushes} seals=${metrics.seals} skips=${metrics.skips} errors=${metrics.errors}`,
      );
    } catch (err) {
      metrics.errors += 1;
      console.error(`keeper poll failed: ${scrub(err, key)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

if (process.argv[1]?.endsWith("index.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message.split("\n")[0] : "keeper failed");
    process.exitCode = 1;
  });
}
