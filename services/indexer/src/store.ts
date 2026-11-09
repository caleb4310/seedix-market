import type { Hex } from "./hex.ts";
import { fromBuffer, toBuffer } from "./hex.ts";

export type QueryResult<T> = { rows: T[]; rowCount: number | null };
export type Queryable = {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
};

export type CoinRow = {
  chainId: number;
  poolId: Hex;
  coin: Hex;
  pair: Hex;
  name: string;
  symbol: string;
  pairSymbol: string;
  mode: number;
  isPlatform: boolean;
  feeRecipient: Hex;
  teamWallet: Hex | null;
  teamAmount: bigint;
  startMcap: bigint;
  launchTime: number;
  launchBlock: bigint;
  coinIsToken0: boolean;
  coinDecimals: number;
  pairDecimals: number;
  category?: number;
  pairStatus?: number;
  description?: string | null;
  website?: string | null;
  xUrl?: string | null;
  telegram?: string | null;
};

export type SwapRow = {
  chainId: number;
  poolId: Hex;
  txHash: Hex;
  logIndex: number;
  sender: Hex;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOut: bigint;
  sqrtPriceX96: bigint;
  price: string;
  blockTime: number;
  blockNumber: bigint;
};

export type FeeRow = {
  chainId: number;
  poolId: Hex;
  txHash: Hex;
  logIndex: number;
  pairSide: boolean;
  hookFeePips: number;
  hookAmt: bigint;
  platformAmt: bigint;
  blockTime: number;
  blockNumber: bigint;
};

export type BuybackRow = {
  chainId: number;
  poolId: Hex;
  txHash: Hex;
  logIndex: number;
  amountIn: bigint;
  coinBurned: bigint;
  blockTime: number;
  blockNumber: bigint;
};

export type EpochRow = {
  chainId: number;
  poolId: Hex;
  epoch: bigint;
  start: number;
  end: number;
  funded: bigint;
  pulled: bigint;
  carry: bigint;
  sealedAmount: bigint | null;
  fundBlock: bigint;
  root: Hex | null;
  manifest: Hex | null;
  postedAt: number | null;
  cancelled: boolean;
};

export type PayoutRow = {
  chainId: number;
  poolId: Hex;
  epoch: bigint;
  kind: string;
  account: Hex;
  amount: bigint;
  txHash: Hex;
  logIndex: number;
  blockTime: number;
  blockNumber: bigint;
};

export type TransferRow = {
  chainId: number;
  poolId: Hex;
  txHash: Hex;
  logIndex: number;
  from: Hex;
  to: Hex;
  amount: bigint;
  blockTime: number;
  blockNumber: bigint;
};

export type KnownCoin = { poolId: Hex; coin: Hex; coinIsToken0: boolean };

export interface Store {
  listCoins(chainId: number): Promise<KnownCoin[]>;
  upsertCoin(row: CoinRow): Promise<void>;
  classifyPair(chainId: number, pair: Hex, status: number, category: number): Promise<void>;
  setSocials(
    chainId: number,
    poolId: Hex,
    socials: { description: string | null; website: string | null; xUrl: string | null; telegram: string | null },
  ): Promise<void>;
  noteTeam(chainId: number, poolId: Hex, team: Hex): Promise<void>;
  addCarry(chainId: number, poolId: Hex, epoch: bigint, amount: bigint, blockNumber: bigint): Promise<void>;
  sealEpoch(chainId: number, poolId: Hex, epoch: bigint, rolled: bigint): Promise<void>;
  forgetFrom(chainId: number, block: bigint): Promise<void>;
  insertSwap(row: SwapRow): Promise<void>;
  insertFee(row: FeeRow): Promise<void>;
  insertBuyback(row: BuybackRow): Promise<void>;
  fundEpoch(row: EpochRow): Promise<void>;
  postEpoch(chainId: number, poolId: Hex, epoch: bigint, root: Hex, manifest: Hex, postedAt: number): Promise<void>;
  cancelEpoch(chainId: number, poolId: Hex, epoch: bigint): Promise<void>;
  insertPayout(row: PayoutRow): Promise<boolean>;
  insertTransfer(row: TransferRow): Promise<boolean>;
  addBalance(chainId: number, poolId: Hex, account: Hex, delta: bigint): Promise<void>;
  getCursor(chainId: number): Promise<bigint | null>;
  setCursor(chainId: number, block: bigint): Promise<void>;
  tx<T>(fn: (store: Store) => Promise<T>): Promise<T>;
}

function stamp(seconds: number): Date {
  return new Date(seconds * 1000);
}

export class PgStore implements Store {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async tx<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    await this.db.query("BEGIN");
    try {
      const result = await fn(this);
      await this.db.query("COMMIT");
      return result;
    } catch (err) {
      await this.db.query("ROLLBACK");
      throw err;
    }
  }

  async listCoins(chainId: number): Promise<KnownCoin[]> {
    const res = await this.db.query<{ pool_id: Buffer; coin: Buffer; coin_is_token0: boolean }>(
      `SELECT pool_id, coin, coin_is_token0 FROM coins WHERE chain_id = $1`,
      [chainId],
    );
    return res.rows.map((row) => ({
      poolId: fromBuffer(row.pool_id),
      coin: fromBuffer(row.coin),
      coinIsToken0: row.coin_is_token0,
    }));
  }

  async upsertCoin(row: CoinRow): Promise<void> {
    await this.db.query(
      `INSERT INTO coins (
         pool_id, chain_id, coin, pair, name, symbol, pair_symbol, mode, is_platform,
         fee_recipient, team_wallet, team_amount, start_mcap, launch_time,
         coin_is_token0, coin_decimals, pair_decimals, launch_block, category, pair_status
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,to_timestamp($14),$15,$16,$17,$18,$19,$20
       )
       ON CONFLICT (pool_id) DO UPDATE SET
         name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE coins.name END,
         symbol = CASE WHEN EXCLUDED.symbol <> '' THEN EXCLUDED.symbol ELSE coins.symbol END,
         pair_symbol = CASE WHEN EXCLUDED.pair_symbol <> '' THEN EXCLUDED.pair_symbol ELSE coins.pair_symbol END,
         coin_is_token0 = EXCLUDED.coin_is_token0,
         coin_decimals = EXCLUDED.coin_decimals,
         pair_decimals = EXCLUDED.pair_decimals,
         category = EXCLUDED.category,
         pair_status = EXCLUDED.pair_status,
         team_wallet = COALESCE(EXCLUDED.team_wallet, coins.team_wallet)`,
      [
        toBuffer(row.poolId),
        row.chainId,
        toBuffer(row.coin),
        toBuffer(row.pair),
        row.name,
        row.symbol,
        row.pairSymbol,
        row.mode,
        row.isPlatform,
        toBuffer(row.feeRecipient),
        row.teamWallet ? toBuffer(row.teamWallet) : null,
        row.teamAmount.toString(),
        row.startMcap.toString(),
        row.launchTime,
        row.coinIsToken0,
        row.coinDecimals,
        row.pairDecimals,
        row.launchBlock.toString(),
        row.category ?? 0,
        row.pairStatus ?? 0,
      ],
    );
  }

  async classifyPair(chainId: number, pair: Hex, status: number, category: number): Promise<void> {
    await this.db.query(
      `INSERT INTO pairs (chain_id, address, status, category) VALUES ($1, $2, $3, $4)
       ON CONFLICT (chain_id, address) DO UPDATE SET status = EXCLUDED.status, category = EXCLUDED.category`,
      [chainId, toBuffer(pair), status, category],
    );
    await this.db.query(`UPDATE coins SET category = $3, pair_status = $2 WHERE chain_id = $1 AND pair = $4`, [
      chainId,
      status,
      category,
      toBuffer(pair),
    ]);
  }

  async setSocials(
    chainId: number,
    poolId: Hex,
    socials: { description: string | null; website: string | null; xUrl: string | null; telegram: string | null },
  ): Promise<void> {
    await this.db.query(
      `UPDATE coins SET description = $3, website = $4, x_url = $5, telegram = $6 WHERE chain_id = $1 AND pool_id = $2`,
      [chainId, toBuffer(poolId), socials.description, socials.website, socials.xUrl, socials.telegram],
    );
  }

  async addCarry(chainId: number, poolId: Hex, epoch: bigint, amount: bigint, blockNumber: bigint): Promise<void> {
    await this.db.query(
      `INSERT INTO kickback_epochs (chain_id, pool_id, epoch, start_time, end_time, funded, pulled, carry, fund_block)
       VALUES ($1,$2,$3,to_timestamp(0),to_timestamp(0),$4,0,$4,$5)
       ON CONFLICT (chain_id, pool_id, epoch) DO UPDATE SET
         carry = kickback_epochs.carry + EXCLUDED.carry,
         funded = kickback_epochs.pulled + kickback_epochs.carry + EXCLUDED.carry,
         fund_block = CASE WHEN kickback_epochs.fund_block = 0 THEN EXCLUDED.fund_block ELSE kickback_epochs.fund_block END`,
      [chainId, toBuffer(poolId), epoch.toString(), amount.toString(), blockNumber.toString()],
    );
  }

  async sealEpoch(chainId: number, poolId: Hex, epoch: bigint, rolled: bigint): Promise<void> {
    await this.db.query(
      `UPDATE kickback_epochs SET sealed_amount = $4 WHERE chain_id = $1 AND pool_id = $2 AND epoch = $3`,
      [chainId, toBuffer(poolId), epoch.toString(), rolled.toString()],
    );
  }

  async forgetFrom(chainId: number, block: bigint): Promise<void> {
    const params = [chainId, block.toString()];
    await this.db.query(`DELETE FROM swaps WHERE chain_id = $1 AND block_number >= $2`, params);
    await this.db.query(`DELETE FROM fees WHERE chain_id = $1 AND block_number >= $2`, params);
    await this.db.query(`DELETE FROM buybacks WHERE chain_id = $1 AND block_number >= $2`, params);
    await this.db.query(`DELETE FROM kickback_payouts WHERE chain_id = $1 AND block_number >= $2`, params);
    await this.db.query(`DELETE FROM transfers WHERE chain_id = $1 AND block_number >= $2`, params);
    await this.db.query(`DELETE FROM kickback_epochs WHERE chain_id = $1 AND fund_block >= $2`, params);
    await this.db.query(`DELETE FROM coins WHERE chain_id = $1 AND launch_block >= $2`, params);
    await this.db.query(`DELETE FROM holders WHERE chain_id = $1`, [chainId]);
    const zero = Buffer.alloc(20);
    await this.db.query(
      `INSERT INTO holders (chain_id, pool_id, account, balance)
       SELECT chain_id, pool_id, account, SUM(delta)
       FROM (
         SELECT chain_id, pool_id, to_address AS account, amount AS delta
         FROM transfers WHERE chain_id = $1 AND to_address <> $2
         UNION ALL
         SELECT chain_id, pool_id, from_address, -amount
         FROM transfers WHERE chain_id = $1 AND from_address <> $2
       ) moves
       GROUP BY chain_id, pool_id, account`,
      [chainId, zero],
    );
  }

  async noteTeam(chainId: number, poolId: Hex, team: Hex): Promise<void> {
    await this.db.query(`UPDATE coins SET team_wallet = $3 WHERE chain_id = $1 AND pool_id = $2`, [
      chainId,
      toBuffer(poolId),
      toBuffer(team),
    ]);
  }

  async insertSwap(row: SwapRow): Promise<void> {
    await this.db.query(
      `INSERT INTO swaps (
         chain_id, pool_id, tx_hash, log_index, sender, zero_for_one, amount_in, amount_out,
         sqrt_price_x96, price, block_time, block_number
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
      [
        row.chainId,
        toBuffer(row.poolId),
        toBuffer(row.txHash),
        row.logIndex,
        toBuffer(row.sender),
        row.zeroForOne,
        row.amountIn.toString(),
        row.amountOut.toString(),
        row.sqrtPriceX96.toString(),
        row.price,
        stamp(row.blockTime),
        row.blockNumber.toString(),
      ],
    );
  }

  async insertFee(row: FeeRow): Promise<void> {
    await this.db.query(
      `INSERT INTO fees (
         chain_id, pool_id, tx_hash, log_index, pair_side, hook_fee_pips, hook_amt, platform_amt, block_time, block_number
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
      [
        row.chainId,
        toBuffer(row.poolId),
        toBuffer(row.txHash),
        row.logIndex,
        row.pairSide,
        row.hookFeePips,
        row.hookAmt.toString(),
        row.platformAmt.toString(),
        stamp(row.blockTime),
        row.blockNumber.toString(),
      ],
    );
  }

  async insertBuyback(row: BuybackRow): Promise<void> {
    await this.db.query(
      `INSERT INTO buybacks (chain_id, pool_id, tx_hash, log_index, amount_in, coin_burned, block_time, block_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
      [
        row.chainId,
        toBuffer(row.poolId),
        toBuffer(row.txHash),
        row.logIndex,
        row.amountIn.toString(),
        row.coinBurned.toString(),
        stamp(row.blockTime),
        row.blockNumber.toString(),
      ],
    );
  }

  async fundEpoch(row: EpochRow): Promise<void> {
    await this.db.query(
      `INSERT INTO kickback_epochs (
         chain_id, pool_id, epoch, start_time, end_time, funded, pulled, carry, fund_block, cancelled
       ) VALUES ($1,$2,$3,to_timestamp($4),to_timestamp($5),$6,$7,$8,$9,$10)
       ON CONFLICT (chain_id, pool_id, epoch) DO UPDATE SET
         pulled = EXCLUDED.pulled,
         funded = EXCLUDED.pulled + kickback_epochs.carry,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         fund_block = EXCLUDED.fund_block`,
      [
        row.chainId,
        toBuffer(row.poolId),
        row.epoch.toString(),
        row.start,
        row.end,
        (row.pulled + row.carry).toString(),
        row.pulled.toString(),
        row.carry.toString(),
        row.fundBlock.toString(),
        row.cancelled,
      ],
    );
  }

  async postEpoch(chainId: number, poolId: Hex, epoch: bigint, root: Hex, manifest: Hex, postedAt: number): Promise<void> {
    const updated = await this.db.query(
      `UPDATE kickback_epochs
       SET root = $4, manifest_hash = $5, posted_at = to_timestamp($6)
       WHERE chain_id = $1 AND pool_id = $2 AND epoch = $3`,
      [chainId, toBuffer(poolId), epoch.toString(), toBuffer(root), toBuffer(manifest), postedAt],
    );
    if ((updated.rowCount ?? 0) > 0) return;
    await this.db.query(
      `INSERT INTO kickback_epochs (chain_id, pool_id, epoch, start_time, end_time, funded, root, manifest_hash, posted_at)
       VALUES ($1,$2,$3,to_timestamp($4),to_timestamp($4),0,$5,$6,to_timestamp($4))`,
      [chainId, toBuffer(poolId), epoch.toString(), postedAt, toBuffer(root), toBuffer(manifest)],
    );
  }

  async cancelEpoch(chainId: number, poolId: Hex, epoch: bigint): Promise<void> {
    await this.db.query(
      `UPDATE kickback_epochs SET cancelled = true WHERE chain_id = $1 AND pool_id = $2 AND epoch = $3`,
      [chainId, toBuffer(poolId), epoch.toString()],
    );
  }

  async insertPayout(row: PayoutRow): Promise<boolean> {
    const res = await this.db.query(
      `INSERT INTO kickback_payouts (
         chain_id, pool_id, epoch, kind, account, amount, tx_hash, log_index, block_time, block_number
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
      [
        row.chainId,
        toBuffer(row.poolId),
        row.epoch.toString(),
        row.kind,
        toBuffer(row.account),
        row.amount.toString(),
        toBuffer(row.txHash),
        row.logIndex,
        stamp(row.blockTime),
        row.blockNumber.toString(),
      ],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async insertTransfer(row: TransferRow): Promise<boolean> {
    const res = await this.db.query(
      `INSERT INTO transfers (
         chain_id, tx_hash, log_index, pool_id, from_address, to_address, amount, block_time, block_number
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
      [
        row.chainId,
        toBuffer(row.txHash),
        row.logIndex,
        toBuffer(row.poolId),
        toBuffer(row.from),
        toBuffer(row.to),
        row.amount.toString(),
        stamp(row.blockTime),
        row.blockNumber.toString(),
      ],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async addBalance(chainId: number, poolId: Hex, account: Hex, delta: bigint): Promise<void> {
    await this.db.query(
      `INSERT INTO holders (chain_id, pool_id, account, balance)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (chain_id, pool_id, account) DO UPDATE SET balance = holders.balance + EXCLUDED.balance`,
      [chainId, toBuffer(poolId), toBuffer(account), delta.toString()],
    );
  }

  async getCursor(chainId: number): Promise<bigint | null> {
    const res = await this.db.query<{ last_block: string }>(
      `SELECT last_block::text AS last_block FROM indexer_cursor WHERE chain_id = $1`,
      [chainId],
    );
    const row = res.rows[0];
    return row ? BigInt(row.last_block) : null;
  }

  async setCursor(chainId: number, block: bigint): Promise<void> {
    await this.db.query(
      `INSERT INTO indexer_cursor (chain_id, last_block) VALUES ($1,$2)
       ON CONFLICT (chain_id) DO UPDATE SET last_block = GREATEST(indexer_cursor.last_block, EXCLUDED.last_block)`,
      [chainId, block.toString()],
    );
  }
}
