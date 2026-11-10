import type { Hex } from "./hex.ts";
import { lower } from "./hex.ts";
import { coinPrice, swapLegs } from "./price.ts";
import type { Store } from "./store.ts";
import { cleanSocials } from "@seedix/shared";

const ZERO = "0x0000000000000000000000000000000000000000";

export type RawLog = {
  address: Hex;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  eventName: string;
  args: Record<string, unknown>;
};

export type CoinMeta = {
  name: string;
  symbol: string;
  pairSymbol: string;
  coinDecimals: number;
  pairDecimals: number;
  coinIsToken0: boolean;
  launchTime: number;
};

export type Readers = {
  blockTime(blockNumber: bigint): Promise<number>;
  coinMeta(coin: Hex, pair: Hex, poolId: Hex): Promise<CoinMeta>;
  epochWindow(poolId: Hex, epoch: bigint): Promise<{ start: number; end: number } | null>;
  readMetadata?(cid: string): Promise<unknown>;
};

function asHex(value: unknown): Hex {
  if (typeof value !== "string" || !value.startsWith("0x")) throw new Error("expected hex");
  return value as Hex;
}

function asBig(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  throw new Error("expected integer");
}

function asBool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("expected bool");
  return value;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("expected number");
}

export async function ingest(store: Store, chainId: number, logs: RawLog[], readers: Readers): Promise<void> {
  const ordered = [...logs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });
  const coins = await store.listCoins(chainId);
  const byPool = new Map(coins.map((coin) => [lower(coin.poolId), coin]));
  const byToken = new Map(coins.map((coin) => [lower(coin.coin), coin.poolId]));

  for (const log of ordered) {
    const time = await readers.blockTime(log.blockNumber);
    const base = { chainId, txHash: log.transactionHash, logIndex: log.logIndex, blockTime: time };
    if (log.eventName === "CoinLaunched") {
      const poolId = asHex(log.args.poolId);
      const coin = asHex(log.args.coin);
      const pair = asHex(log.args.pair);
      const meta = await readers.coinMeta(coin, pair, poolId);
      const team = asHex(log.args.teamWallet);
      await store.upsertCoin({
        chainId,
        poolId,
        coin,
        pair,
        name: meta.name,
        symbol: meta.symbol,
        pairSymbol: meta.pairSymbol,
        mode: asNumber(log.args.mode),
        isPlatform: asBool(log.args.isPlatform),
        feeRecipient: asHex(log.args.feeRecipient),
        teamWallet: lower(team) === ZERO ? null : team,
        teamAmount: asBig(log.args.teamAmount),
        startMcap: asBig(log.args.startMcap),
        launchTime: meta.launchTime,
        launchBlock: log.blockNumber,
        coinIsToken0: meta.coinIsToken0,
        coinDecimals: meta.coinDecimals,
        pairDecimals: meta.pairDecimals,
        category: typeof log.args.category === "number" || typeof log.args.category === "bigint" ? asNumber(log.args.category) : 0,
        pairStatus:
          typeof log.args.pairStatus === "number" || typeof log.args.pairStatus === "bigint"
            ? asNumber(log.args.pairStatus)
            : 0,
      });
      if (typeof log.args.backing === "string" && log.args.backing.startsWith("0x") && !/^0x0{40}$/i.test(log.args.backing)) {
        await store.setBacking(chainId, poolId, asHex(log.args.backing));
      }
      byPool.set(lower(poolId), { poolId, coin, coinIsToken0: meta.coinIsToken0 });
      byToken.set(lower(coin), poolId);
      continue;
    }
    if (log.eventName === "PairClassified") {
      await store.classifyPair(chainId, asHex(log.args.pair), asNumber(log.args.status), asNumber(log.args.category));
      continue;
    }
    if (log.eventName === "MetadataPinned") {
      const poolId = asHex(log.args.poolId);
      const cid = typeof log.args.cid === "string" ? log.args.cid : "";
      const raw = readers.readMetadata ? await readers.readMetadata(cid) : null;
      const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const socials = cleanSocials(record);
      await store.setSocials(chainId, poolId, {
        description: socials.description,
        website: socials.website,
        xUrl: socials.x,
        telegram: socials.telegram,
      });
      continue;
    }
    if (log.eventName === "Swap") {
      const poolId = asHex(log.args.id);
      const known = byPool.get(lower(poolId));
      if (!known) continue;
      const legs = swapLegs(asBig(log.args.amount0), asBig(log.args.amount1));
      const sqrtPriceX96 = asBig(log.args.sqrtPriceX96);
      await store.insertSwap({
        ...base,
        poolId,
        sender: asHex(log.args.sender),
        zeroForOne: legs.zeroForOne,
        amountIn: legs.amountIn,
        amountOut: legs.amountOut,
        sqrtPriceX96,
        price: coinPrice(sqrtPriceX96, known.coinIsToken0),
        blockNumber: log.blockNumber,
      });
      continue;
    }
    if (log.eventName === "FeesTaken") {
      await store.insertFee({
        ...base,
        poolId: asHex(log.args.poolId),
        pairSide: asBool(log.args.pairSide),
        hookFeePips: asNumber(log.args.hookFeePips),
        hookAmt: asBig(log.args.hookAmt),
        platformAmt: asBig(log.args.platformAmt),
        blockNumber: log.blockNumber,
      });
      continue;
    }
    if (log.eventName === "BuybackExecuted") {
      await store.insertBuyback({
        ...base,
        poolId: asHex(log.args.poolId),
        amountIn: asBig(log.args.amountIn),
        coinBurned: asBig(log.args.coinBurned),
        blockNumber: log.blockNumber,
      });
      continue;
    }
    if (log.eventName === "KickbackFunded") {
      const poolId = asHex(log.args.poolId);
      const epoch = asBig(log.args.epoch);
      const window = (await readers.epochWindow(poolId, epoch)) ?? { start: time, end: time };
      await store.fundEpoch({
        chainId,
        poolId,
        epoch,
        start: window.start,
        end: window.end,
        funded: asBig(log.args.amount),
        pulled: asBig(log.args.amount),
        carry: 0n,
        sealedAmount: null,
        fundBlock: log.blockNumber,
        root: null,
        manifest: null,
        postedAt: null,
        cancelled: false,
      });
      continue;
    }
    if (log.eventName === "RolloverApplied") {
      await store.addCarry(chainId, asHex(log.args.poolId), asBig(log.args.epoch), asBig(log.args.amount), log.blockNumber);
      continue;
    }
    if (log.eventName === "RoundSealed") {
      await store.sealEpoch(chainId, asHex(log.args.poolId), asBig(log.args.epoch), asBig(log.args.rolled));
      continue;
    }
    if (log.eventName === "RootPosted") {
      await store.postEpoch(
        chainId,
        asHex(log.args.poolId),
        asBig(log.args.epoch),
        asHex(log.args.root),
        asHex(log.args.manifestHash),
        time,
      );
      continue;
    }
    if (log.eventName === "KickbackCancelled") {
      await store.cancelEpoch(chainId, asHex(log.args.poolId), asBig(log.args.epoch));
      continue;
    }
    if (
      log.eventName === "KickbackClaimed" ||
      log.eventName === "Pushed" ||
      log.eventName === "Rolled" ||
      log.eventName === "ClaimableCredited" ||
      log.eventName === "FailedPull" ||
      log.eventName === "GasReimbursed"
    ) {
      const account = log.eventName === "GasReimbursed" ? asHex(log.args.keeper) : asHex(log.args.account);
      await store.insertPayout({
        ...base,
        poolId: asHex(log.args.poolId),
        epoch: asBig(log.args.epoch),
        kind: log.eventName,
        account,
        amount: asBig(log.args.amount),
        blockNumber: log.blockNumber,
      });
      continue;
    }
    if (log.eventName === "Transfer") {
      const poolId = byToken.get(lower(log.address));
      if (!poolId) continue;
      const from = asHex(log.args.from);
      const to = asHex(log.args.to);
      const amount = asBig(log.args.amount);
      const fresh = await store.insertTransfer({ ...base, poolId, from, to, amount, blockNumber: log.blockNumber });
      if (!fresh || amount === 0n) continue;
      if (lower(from) !== ZERO) await store.addBalance(chainId, poolId, from, -amount);
      if (lower(to) !== ZERO) await store.addBalance(chainId, poolId, to, amount);
    }
  }
}
