import type { Hex } from "./hex.ts";
import { lower } from "./hex.ts";
import type { BuybackRow, CoinRow, EpochRow, FeeRow, KnownCoin, PayoutRow, Store, SwapRow, TransferRow } from "./store.ts";

function logKey(chainId: number, tx: string, logIndex: number): string {
  return `${chainId}:${lower(tx)}:${logIndex}`;
}

export class MemoryStore implements Store {
  readonly coins = new Map<string, CoinRow>();
  readonly swaps = new Map<string, SwapRow>();
  readonly fees = new Map<string, FeeRow>();
  readonly buybacks = new Map<string, BuybackRow>();
  readonly epochs = new Map<string, EpochRow>();
  readonly payouts = new Map<string, PayoutRow>();
  readonly transfers = new Map<string, TransferRow>();
  readonly balances = new Map<string, bigint>();
  cursor: bigint | null = null;

  async listCoins(chainId: number): Promise<KnownCoin[]> {
    return [...this.coins.values()]
      .filter((row) => row.chainId === chainId)
      .map((row) => ({ poolId: row.poolId, coin: row.coin, coinIsToken0: row.coinIsToken0 }));
  }

  readonly pairs = new Map<string, { status: number; category: number }>();

  async setBacking(): Promise<void> {}

  async classifyPair(chainId: number, pair: Hex, status: number, category: number): Promise<void> {
    this.pairs.set(`${chainId}:${lower(pair)}`, { status, category });
    for (const [key, coin] of this.coins) {
      if (coin.chainId === chainId && lower(coin.pair) === lower(pair)) {
        this.coins.set(key, { ...coin, category, pairStatus: status });
      }
    }
  }

  async setSocials(
    chainId: number,
    poolId: Hex,
    socials: { description: string | null; website: string | null; xUrl: string | null; telegram: string | null },
  ): Promise<void> {
    const coin = this.coins.get(lower(poolId));
    if (!coin || coin.chainId !== chainId) return;
    this.coins.set(lower(poolId), {
      ...coin,
      description: socials.description,
      website: socials.website,
      xUrl: socials.xUrl,
      telegram: socials.telegram,
    });
  }

  async upsertCoin(row: CoinRow): Promise<void> {
    const prev = this.coins.get(lower(row.poolId));
    this.coins.set(lower(row.poolId), {
      ...row,
      name: row.name || prev?.name || "",
      symbol: row.symbol || prev?.symbol || "",
      pairSymbol: row.pairSymbol || prev?.pairSymbol || "",
      teamWallet: row.teamWallet ?? prev?.teamWallet ?? null,
      launcher: row.launcher ?? prev?.launcher ?? null,
    });
  }

  async addCarry(chainId: number, poolId: Hex, epoch: bigint, amount: bigint, blockNumber: bigint): Promise<void> {
    const key = `${chainId}:${lower(poolId)}:${epoch}`;
    const prev = this.epochs.get(key);
    const carry = (prev?.carry ?? 0n) + amount;
    const pulled = prev?.pulled ?? 0n;
    this.epochs.set(key, {
      chainId,
      poolId,
      epoch,
      start: prev?.start ?? 0,
      end: prev?.end ?? 0,
      funded: pulled + carry,
      pulled,
      carry,
      sealedAmount: prev?.sealedAmount ?? null,
      fundBlock: prev?.fundBlock && prev.fundBlock !== 0n ? prev.fundBlock : blockNumber,
      root: prev?.root ?? null,
      manifest: prev?.manifest ?? null,
      postedAt: prev?.postedAt ?? null,
      cancelled: prev?.cancelled ?? false,
    });
  }

  async sealEpoch(chainId: number, poolId: Hex, epoch: bigint, rolled: bigint): Promise<void> {
    const key = `${chainId}:${lower(poolId)}:${epoch}`;
    const prev = this.epochs.get(key);
    if (prev) prev.sealedAmount = rolled;
  }

  async forgetFrom(chainId: number, block: bigint): Promise<void> {
    for (const [key, row] of this.swaps) if (row.chainId === chainId && row.blockNumber >= block) this.swaps.delete(key);
    for (const [key, row] of this.fees) if (row.chainId === chainId && row.blockNumber >= block) this.fees.delete(key);
    for (const [key, row] of this.buybacks) if (row.chainId === chainId && row.blockNumber >= block) this.buybacks.delete(key);
    for (const [key, row] of this.payouts) if (row.chainId === chainId && row.blockNumber >= block) this.payouts.delete(key);
    for (const [key, row] of this.transfers) if (row.chainId === chainId && row.blockNumber >= block) this.transfers.delete(key);
    for (const [key, row] of this.epochs) if (row.chainId === chainId && row.fundBlock >= block) this.epochs.delete(key);
    for (const [key, row] of this.coins) if (row.chainId === chainId && row.launchBlock >= block) this.coins.delete(key);
    this.balances.clear();
    for (const row of this.transfers.values()) {
      if (row.chainId !== chainId) continue;
      const credit = `${row.chainId}:${lower(row.poolId)}:${lower(row.to)}`;
      const debit = `${row.chainId}:${lower(row.poolId)}:${lower(row.from)}`;
      if (lower(row.to) !== "0x0000000000000000000000000000000000000000") {
        this.balances.set(credit, (this.balances.get(credit) ?? 0n) + row.amount);
      }
      if (lower(row.from) !== "0x0000000000000000000000000000000000000000") {
        this.balances.set(debit, (this.balances.get(debit) ?? 0n) - row.amount);
      }
    }
  }

  async noteTeam(_chainId: number, poolId: Hex, team: Hex): Promise<void> {
    const row = this.coins.get(lower(poolId));
    if (row) row.teamWallet = team;
  }

  async insertSwap(row: SwapRow): Promise<void> {
    const key = logKey(row.chainId, row.txHash, row.logIndex);
    if (!this.swaps.has(key)) this.swaps.set(key, row);
  }

  async insertFee(row: FeeRow): Promise<void> {
    const key = logKey(row.chainId, row.txHash, row.logIndex);
    if (!this.fees.has(key)) this.fees.set(key, row);
  }

  async insertBuyback(row: BuybackRow): Promise<void> {
    const key = logKey(row.chainId, row.txHash, row.logIndex);
    if (!this.buybacks.has(key)) this.buybacks.set(key, row);
  }

  async fundEpoch(row: EpochRow): Promise<void> {
    const key = `${row.chainId}:${lower(row.poolId)}:${row.epoch}`;
    const prev = this.epochs.get(key);
    const carry = prev?.carry ?? row.carry;
    const pulled = row.pulled;
    this.epochs.set(key, {
      ...row,
      carry,
      pulled,
      funded: pulled + carry,
      sealedAmount: prev?.sealedAmount ?? row.sealedAmount,
      root: row.root ?? prev?.root ?? null,
      manifest: row.manifest ?? prev?.manifest ?? null,
      postedAt: prev?.postedAt ?? row.postedAt,
      cancelled: prev?.cancelled ?? row.cancelled,
    });
  }

  async postEpoch(chainId: number, poolId: Hex, epoch: bigint, root: Hex, manifest: Hex, postedAt: number): Promise<void> {
    const key = `${chainId}:${lower(poolId)}:${epoch}`;
    const prev = this.epochs.get(key);
    this.epochs.set(key, {
      chainId,
      poolId,
      epoch,
      start: prev?.start ?? postedAt,
      end: prev?.end ?? postedAt,
      funded: prev?.funded ?? 0n,
      pulled: prev?.pulled ?? 0n,
      carry: prev?.carry ?? 0n,
      sealedAmount: prev?.sealedAmount ?? null,
      fundBlock: prev?.fundBlock ?? 0n,
      root,
      manifest,
      postedAt,
      cancelled: prev?.cancelled ?? false,
    });
  }

  async cancelEpoch(chainId: number, poolId: Hex, epoch: bigint): Promise<void> {
    const key = `${chainId}:${lower(poolId)}:${epoch}`;
    const prev = this.epochs.get(key);
    if (prev) prev.cancelled = true;
  }

  async insertPayout(row: PayoutRow): Promise<boolean> {
    const key = logKey(row.chainId, row.txHash, row.logIndex);
    if (this.payouts.has(key)) return false;
    this.payouts.set(key, row);
    return true;
  }

  async insertTransfer(row: TransferRow): Promise<boolean> {
    const key = logKey(row.chainId, row.txHash, row.logIndex);
    if (this.transfers.has(key)) return false;
    this.transfers.set(key, row);
    return true;
  }

  async addBalance(chainId: number, poolId: Hex, account: Hex, delta: bigint): Promise<void> {
    const key = `${chainId}:${lower(poolId)}:${lower(account)}`;
    this.balances.set(key, (this.balances.get(key) ?? 0n) + delta);
  }

  async getCursor(): Promise<bigint | null> {
    return this.cursor;
  }

  async setCursor(_chainId: number, block: bigint): Promise<void> {
    if (this.cursor === null || block > this.cursor) this.cursor = block;
  }

  async tx<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
