import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { elysiumTestnet } from "@seedix/shared";
import {
  artifactName,
  claimSum,
  manifestBody,
  manifestHash,
  nextStep,
  withRetry,
  type EpochState,
  type Step,
} from "./broadcast.ts";
import { buildPayableRound, type GasPlan, WAD } from "./gas.ts";
import { assertKeyFile, loadKey, publisherKeyPath } from "./key.ts";
import type { Round } from "./round.ts";

const REVIEW_SECONDS = 60 * 60;
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

const chain = defineChain({
  id: elysiumTestnet.id,
  name: elysiumTestnet.name,
  nativeCurrency: { ...elysiumTestnet.nativeCurrency },
  rpcUrls: { default: { http: [...elysiumTestnet.rpcUrls] } },
});

const hookAbi = parseAbi([
  "function pots(bytes32) view returns (uint128, uint128, uint128, uint128, uint128)",
  "function backingOf(bytes32) view returns (address)",
  "function config(bytes32) view returns (address, address, bool, uint8, bool, uint40, address)",
]);
const distributorAbi = parseAbi([
  "function fund(bytes32,uint128) returns (uint64)",
  "function postRootAllocated(bytes32,uint64,bytes32,bytes32,uint128)",
  "function push(bytes32,uint64,address[],uint256[],bytes32[][]) returns (uint256)",
  "function seal(bytes32,uint64)",
  "function nextEpoch(bytes32) view returns (uint64)",
  "function epochs(bytes32,uint64) view returns (uint128,uint128,uint64,uint64,uint64,bytes32,bytes32,bool)",
  "function claimed(bytes32,uint64,address) view returns (bool)",
  "function roundClosed(bytes32,uint64) view returns (bool)",
  "function kickbackPaused() view returns (bool)",
  "function dustThreshold() view returns (uint256)",
  "function poolCarry(bytes32) view returns (uint256)",
]);
const quoteAbi = parseAbi([
  "function quoteReward(address,uint256) view returns (uint256)",
  "function whype() view returns (address)",
]);

type CoinRow = {
  poolId: Hex;
  coin: Address;
  pair: Address;
  teamWallet: Address | null;
  backing: Address | null;
};

function asAddress(value: string | null | undefined): Address | null {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value) || value.toLowerCase() === ZERO) return null;
  return value as Address;
}

function asHex(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

function maxFeeWei(): bigint {
  const gwei = Number(process.env.KICKBACK_MAX_FEE_GWEI ?? "100");
  if (!Number.isFinite(gwei) || gwei <= 0) return 100n * 10n ** 9n;
  return BigInt(Math.floor(gwei)) * 10n ** 9n;
}

async function listedCoins(api: string): Promise<CoinRow[]> {
  const response = await fetch(`${api}/coins?mode=kickback`);
  if (!response.ok) throw new Error(`coin list failed (${response.status})`);
  const body = (await response.json()) as { coins?: Array<Record<string, unknown>> };
  const rows: CoinRow[] = [];
  for (const coin of body.coins ?? []) {
    const poolId = typeof coin.poolId === "string" ? asHex(coin.poolId) : null;
    const token = asAddress(typeof coin.coin === "string" ? coin.coin : null);
    const pair = asAddress(typeof coin.pair === "string" ? coin.pair : null);
    if (!poolId || poolId.length !== 66 || !token || !pair) continue;
    rows.push({
      poolId,
      coin: token,
      pair,
      teamWallet: asAddress(typeof coin.teamWallet === "string" ? coin.teamWallet : null),
      backing: asAddress(typeof coin.backing === "string" ? coin.backing : null),
    });
  }
  return rows;
}

async function holdersOf(api: string, poolId: Hex): Promise<{ account: Address; balance: bigint }[]> {
  const response = await fetch(`${api}/coins/${poolId}/holders?limit=5000`);
  if (!response.ok) throw new Error(`holders failed (${response.status})`);
  const body = (await response.json()) as { holders?: Array<{ account?: string; balance?: string }> };
  const rows: { account: Address; balance: bigint }[] = [];
  for (const row of body.holders ?? []) {
    const account = asAddress(row.account ?? null);
    if (!account) continue;
    rows.push({ account, balance: BigInt(row.balance ?? "0") });
  }
  return rows;
}

async function contractAccounts(client: PublicClient, accounts: Address[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < accounts.length; i += 16) {
    const slice = accounts.slice(i, i + 16);
    const codes = await Promise.all(slice.map((account) => client.getCode({ address: account })));
    slice.forEach((account, index) => {
      const code = codes[index];
      if (code && code !== "0x") found.add(account.toLowerCase());
    });
  }
  return found;
}

function readEpoch(value: readonly [bigint, bigint, bigint, bigint, bigint, Hex, Hex, boolean]): EpochState {
  return { funded: value[0], postedAt: value[4], root: value[5], cancelled: value[7] };
}

async function loadRound(dir: string, poolId: Hex, epoch: bigint): Promise<Round | null> {
  try {
    const text = await readFile(path.join(dir, artifactName(poolId, epoch)), "utf8");
    const parsed = JSON.parse(text) as {
      chainId: number;
      distributor: Address;
      coin: Address;
      pair: Address;
      claims: { account: Address; amount: string }[];
      proofs: Hex[][];
      root: Hex;
    };
    return {
      chainId: BigInt(parsed.chainId),
      distributor: parsed.distributor,
      coin: parsed.coin,
      pair: parsed.pair,
      epoch,
      claims: parsed.claims.map((claim) => ({ account: claim.account, amount: BigInt(claim.amount) })),
      proofs: parsed.proofs,
      root: parsed.root,
    };
  } catch {
    return null;
  }
}

async function saveRound(dir: string, poolId: Hex, round: Round, plan: GasPlan): Promise<void> {
  await mkdir(dir, { recursive: true });
  const body = JSON.parse(manifestBody(poolId, round, round.epoch)) as Record<string, unknown>;
  body.proofs = round.proofs;
  body.gross = plan.gross.toString();
  body.gasReserve = plan.reserve.toString();
  body.cap = plan.cap.toString();
  body.distributable = plan.distributable.toString();
  await writeFile(path.join(dir, artifactName(poolId, round.epoch)), JSON.stringify(body));
}

function fee(): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const cap = maxFeeWei();
  const tip = 1n * 10n ** 9n;
  return { maxFeePerGas: cap > tip ? cap : tip, maxPriorityFeePerGas: tip > cap ? cap : tip };
}

async function broadcast(
  wallet: WalletClient,
  account: PrivateKeyAccount,
  distributor: Address,
  poolId: Hex,
  step: Exclude<Step, { op: "skip" }>,
  round: Round | null,
): Promise<Hex> {
  const base = { account, address: distributor, abi: distributorAbi, chain, ...fee() } as const;
  if (step.op === "fund") {
    return wallet.writeContract({ ...base, functionName: "fund", args: [poolId, step.amount] });
  }
  if (step.op === "post") {
    return wallet.writeContract({
      ...base,
      functionName: "postRootAllocated",
      args: [poolId, step.epoch, step.root, step.manifestHash, step.allocated],
    });
  }
  if (step.op === "seal") {
    return wallet.writeContract({ ...base, functionName: "seal", args: [poolId, step.epoch] });
  }
  if (!round) throw new Error("push is missing its round");
  return wallet.writeContract({
    ...base,
    functionName: "push",
    args: [poolId, step.epoch, step.accounts, step.amounts, step.proofs],
  });
}

export async function runPublisher(): Promise<void> {
  const rpc = process.env.RPC_URL ?? "";
  const hook = asAddress(process.env.HOOK_ADDRESS ?? "");
  const distributor = asAddress(process.env.KICKBACK_DISTRIBUTOR ?? "");
  const executor = asAddress(process.env.BUYBACK_EXECUTOR ?? "");
  const api = process.env.API_URL ?? "";
  const dry = process.env.KICKBACK_DRY_RUN === "1";
  if (!rpc || !hook || !distributor || !api) {
    console.log("kickback publisher idle: set RPC_URL, HOOK_ADDRESS, KICKBACK_DISTRIBUTOR, and API_URL");
    return;
  }
  let account: PrivateKeyAccount | undefined;
  if (!dry) {
    const file = publisherKeyPath(process.env);
    if (!file) throw new Error("PUBLISHER_PRIVATE_KEY must be the path of the key file");
    const info = await stat(file);
    assertKeyFile(file, info.mode, info.uid);
    account = privateKeyToAccount(loadKey(await readFile(file, "utf8")));
  }
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ chain, transport: http(rpc) });
  const dir = process.env.KICKBACK_MANIFEST_DIR ?? "/var/lib/seedix/manifests";
  console.log(`kickback publisher ${dry ? "dry-run" : account?.address} on chain ${chain.id}`);
  for (;;) {
    try {
      await pass({ publicClient, wallet, account, hook, distributor, executor, api, dir, dry });
    } catch (err) {
      console.error(err instanceof Error ? err.message : "kickback pass failed");
    }
    if (process.env.KICKBACK_ONCE === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

async function pass(input: {
  publicClient: PublicClient;
  wallet: WalletClient;
  account: PrivateKeyAccount | undefined;
  hook: Address;
  distributor: Address;
  executor: Address | null;
  api: string;
  dir: string;
  dry: boolean;
}): Promise<void> {
  const paused = await input.publicClient.readContract({
    address: input.distributor,
    abi: distributorAbi,
    functionName: "kickbackPaused",
  });
  const dust = await input.publicClient.readContract({
    address: input.distributor,
    abi: distributorAbi,
    functionName: "dustThreshold",
  });
  const whype = input.executor
    ? await input.publicClient.readContract({ address: input.executor, abi: quoteAbi, functionName: "whype" })
    : null;
  const gasPrice = await input.publicClient.getGasPrice();
  const priced = gasPrice > maxFeeWei() ? maxFeeWei() : gasPrice;
  const coins = await listedCoins(input.api);
  const block = await input.publicClient.getBlock();
  for (const coin of coins) {
    await onePool({ ...input, coin, paused, dust, whype, gasPrice: priced, now: block.timestamp });
  }
}

async function onePool(input: {
  publicClient: PublicClient;
  wallet: WalletClient;
  account: PrivateKeyAccount | undefined;
  hook: Address;
  distributor: Address;
  executor: Address | null;
  api: string;
  dir: string;
  dry: boolean;
  coin: CoinRow;
  paused: boolean;
  dust: bigint;
  whype: Address | null;
  gasPrice: bigint;
  now: bigint;
}): Promise<void> {
  const poolId = input.coin.poolId;
  const pots = await input.publicClient.readContract({
    address: input.hook,
    abi: hookAbi,
    functionName: "pots",
    args: [poolId],
  });
  const hookPot = pots[2];
  const carry = await input.publicClient.readContract({
    address: input.distributor,
    abi: distributorAbi,
    functionName: "poolCarry",
    args: [poolId],
  });
  const latestId = await input.publicClient.readContract({
    address: input.distributor,
    abi: distributorAbi,
    functionName: "nextEpoch",
    args: [poolId],
  });
  let latest: EpochState | null = null;
  let sealed = false;
  if (latestId > 0n) {
    const epoch = await input.publicClient.readContract({
      address: input.distributor,
      abi: distributorAbi,
      functionName: "epochs",
      args: [poolId, latestId],
    });
    latest = readEpoch(epoch);
    sealed = await input.publicClient.readContract({
      address: input.distributor,
      abi: distributorAbi,
      functionName: "roundClosed",
      args: [poolId, latestId],
    });
  }
  const backing = await input.publicClient.readContract({
    address: input.hook,
    abi: hookAbi,
    functionName: "backingOf",
    args: [poolId],
  });
  const reward = backing.toLowerCase() === ZERO ? input.coin.pair : backing;
  const rewardIsHype =
    backing.toLowerCase() === ZERO || (input.whype !== null && reward.toLowerCase() === input.whype.toLowerCase());
  let rewardPerHype = rewardIsHype ? WAD : 0n;
  if (!rewardIsHype && input.executor) {
    rewardPerHype = await input.publicClient.readContract({
      address: input.executor,
      abi: quoteAbi,
      functionName: "quoteReward",
      args: [reward, WAD],
    });
  }
  const posting = latest && !latest.cancelled && latest.postedAt === 0n && latest.funded > 0n;
  const pushing = latest && !latest.cancelled && latest.postedAt > 0n && !sealed;
  const epochForBuild = posting || pushing ? latestId : latestId + 1n;
  const potForBuild = posting || pushing ? (latest?.funded ?? 0n) : hookPot + carry;
  const saved = pushing ? await loadRound(input.dir, poolId, latestId) : null;
  let round: Round | null = saved;
  let plan: GasPlan | null = null;
  if (!pushing) {
    const people = await holdersOf(input.api, poolId);
    const contracts = await contractAccounts(input.publicClient, people.map((holder) => holder.account));
    const excluded = [ZERO, DEAD, input.hook, input.distributor, input.coin.coin, reward];
    if (input.coin.teamWallet) excluded.push(input.coin.teamWallet);
    if (input.executor) excluded.push(input.executor);
    for (const account of contracts) excluded.push(account);
    const built = buildPayableRound({
      chainId: BigInt(chain.id),
      distributor: input.distributor,
      coin: input.coin.coin,
      pair: reward,
      epoch: epochForBuild,
      holders: people,
      pot: potForBuild,
      dust: input.dust,
      gasPrice: input.gasPrice,
      rewardPerHype,
      rewardIsHype,
      excluded,
    });
    round = built.round;
    plan = built.plan;
    if (round && plan) await saveRound(input.dir, poolId, round, plan);
  }
  const claimed = new Set<string>();
  if (pushing && round) {
    for (const claim of round.claims) {
      const paid = await input.publicClient.readContract({
        address: input.distributor,
        abi: distributorAbi,
        functionName: "claimed",
        args: [poolId, latestId, claim.account],
      });
      if (paid) claimed.add(claim.account.toLowerCase());
    }
  }
  const reviewOpen = Boolean(latest && latest.postedAt > 0n && input.now >= latest.postedAt + BigInt(REVIEW_SECONDS));
  const step = nextStep({
    poolId,
    pot: hookPot,
    carry,
    latest,
    latestId,
    round,
    claimed,
    reviewOpen,
    sealed,
    paused: input.paused,
    unpriced: plan?.unpriced === true,
  });
  const gross = plan?.gross ?? latest?.funded ?? hookPot + carry;
  const reserve = plan?.reserve ?? 0n;
  console.log(
    `${poolId} ${step.op}${step.op === "skip" ? ` (${step.reason})` : ""} gross=${gross} gasReserve=${reserve} holders=${round?.claims.length ?? 0}`,
  );
  if (step.op === "skip" || input.dry || !input.account) return;
  if (step.op === "post" && round) {
    const body = manifestBody(poolId, round, step.epoch);
    if (manifestHash(body) !== step.manifestHash || claimSum(round) !== step.allocated) {
      throw new Error("posted manifest does not match the round");
    }
  }
  const hash = await withRetry(
    () => broadcast(input.wallet, input.account as PrivateKeyAccount, input.distributor, poolId, step, round),
    [2_000, 4_000, 8_000],
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  await input.publicClient.waitForTransactionReceipt({ hash });
  console.log(`${poolId} ${step.op} tx ${hash}`);
}
