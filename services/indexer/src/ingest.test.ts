import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Hex } from "./hex.ts";
import { ingest, type RawLog, type Readers } from "./ingest.ts";
import { MemoryStore } from "./memory.ts";
import { coinPrice, confirmedTip, nextRange, swapLegs } from "./price.ts";

const pool = `0x${"11".repeat(32)}` as Hex;
const coin = `0x${"22".repeat(20)}` as Hex;
const pair = `0x${"33".repeat(20)}` as Hex;
const holder = `0x${"44".repeat(20)}` as Hex;
const zero = "0x0000000000000000000000000000000000000000" as Hex;
const sqrt = 2n * (1n << 96n);

const readers: Readers = {
  async blockTime() {
    return 1_700_000_000;
  },
  async coinMeta() {
    return {
      name: "Example",
      symbol: "EX",
      pairSymbol: "WHYPE",
      coinDecimals: 18,
      pairDecimals: 18,
      coinIsToken0: true,
      launchTime: 1_700_000_000,
    };
  },
  async epochWindow() {
    return { start: 1_699_996_400, end: 1_700_000_000 };
  },
};

function logs(): RawLog[] {
  return [
    {
      address: coin,
      blockNumber: 10n,
      logIndex: 2,
      transactionHash: `0x${"aa".repeat(32)}`,
      eventName: "Transfer",
      args: { from: zero, to: holder, amount: 1_000n },
    },
    {
      address: "0x00000000000000000000000000000000000000c0",
      blockNumber: 10n,
      logIndex: 0,
      transactionHash: `0x${"aa".repeat(32)}`,
      eventName: "CoinLaunched",
      args: {
        poolId: pool,
        coin,
        pair,
        mode: 1,
        isPlatform: false,
        feeRecipient: holder,
        teamWallet: zero,
        teamAmount: 0n,
        startMcap: 10n,
      },
    },
    {
      address: "0x00000000000000000000000000000000000000c0",
      blockNumber: 11n,
      logIndex: 1,
      transactionHash: `0x${"bb".repeat(32)}`,
      eventName: "Swap",
      args: { id: pool, sender: holder, amount0: 10n, amount1: -4n, sqrtPriceX96: sqrt },
    },
    {
      address: "0x00000000000000000000000000000000000000c0",
      blockNumber: 11n,
      logIndex: 4,
      transactionHash: `0x${"cc".repeat(32)}`,
      eventName: "BuybackExecuted",
      args: { poolId: pool, amountIn: 3n, coinBurned: 9n },
    },
    {
      address: "0x00000000000000000000000000000000000000c0",
      blockNumber: 12n,
      logIndex: 1,
      transactionHash: `0x${"dd".repeat(32)}`,
      eventName: "Pushed",
      args: { poolId: pool, epoch: 1n, account: holder, amount: 5n },
    },
    {
      address: "0x00000000000000000000000000000000000000c0",
      blockNumber: 12n,
      logIndex: 2,
      transactionHash: `0x${"ee".repeat(32)}`,
      eventName: "Swap",
      args: { id: `0x${"99".repeat(32)}`, sender: holder, amount0: 1n, amount1: -1n, sqrtPriceX96: sqrt },
    },
  ];
}

describe("indexer math", () => {
  it("prices the coin from the sqrt price", () => {
    assert.equal(coinPrice(1n << 96n, true), "1");
    assert.equal(coinPrice(sqrt, true), "4");
    assert.equal(coinPrice(sqrt, false), "0.25");
  });

  it("reads the paid and received legs", () => {
    assert.deepEqual(swapLegs(10n, -4n), { zeroForOne: true, amountIn: 10n, amountOut: 4n });
    assert.deepEqual(swapLegs(-4n, 10n), { zeroForOne: false, amountIn: 10n, amountOut: 4n });
  });

  it("walks forward with a small overlap", () => {
    assert.deepEqual(nextRange(null, 10n, 5000n), { from: 10n, to: 2009n });
    assert.deepEqual(nextRange(2009n, 10n, 5000n), { from: 1998n, to: 3997n });
    assert.deepEqual(nextRange(5000n, 10n, 5000n), { from: 4989n, to: 5000n });
    assert.equal(nextRange(5000n, 10n, 4988n), null);
  });

  it("stays behind the chain tip by the confirmation depth", () => {
    assert.equal(confirmedTip(100n, 12n), 88n);
    assert.equal(confirmedTip(11n, 12n), null);
  });
});

describe("ingest", () => {
  it("keeps balances and payouts when the same logs arrive twice", async () => {
    const store = new MemoryStore();
    await ingest(store, 99801, logs(), readers);
    await ingest(store, 99801, logs(), readers);
    assert.equal(store.balances.get(`99801:${pool.toLowerCase()}:${holder.toLowerCase()}`), 1_000n);
    assert.equal(store.swaps.size, 1);
    assert.equal([...store.swaps.values()][0]?.price, "4");
    assert.equal(store.buybacks.size, 1);
    assert.equal(store.payouts.size, 1);
    assert.equal([...store.payouts.values()][0]?.kind, "Pushed");
    assert.equal(store.coins.size, 1);
  });

  it("records carry, a failed push, gas, and a seal, then drops them on rewind", async () => {
    const store = new MemoryStore();
    const tx = `0x${"ab".repeat(32)}` as Hex;
    await ingest(
      store,
      99801,
      [
        ...logs(),
        {
          address: coin,
          blockNumber: 12n,
          logIndex: 3,
          transactionHash: tx,
          eventName: "RolloverApplied",
          args: { poolId: pool, epoch: 2n, amount: 7n },
        },
        {
          address: coin,
          blockNumber: 12n,
          logIndex: 4,
          transactionHash: tx,
          eventName: "KickbackFunded",
          args: { poolId: pool, epoch: 2n, amount: 11n },
        },
        {
          address: coin,
          blockNumber: 12n,
          logIndex: 5,
          transactionHash: tx,
          eventName: "ClaimableCredited",
          args: { poolId: pool, epoch: 2n, account: holder, amount: 2n },
        },
        {
          address: coin,
          blockNumber: 12n,
          logIndex: 6,
          transactionHash: tx,
          eventName: "GasReimbursed",
          args: { poolId: pool, epoch: 2n, keeper: holder, amount: 1n },
        },
        {
          address: coin,
          blockNumber: 12n,
          logIndex: 7,
          transactionHash: tx,
          eventName: "RoundSealed",
          args: { poolId: pool, epoch: 2n, rolled: 4n },
        },
        {
          address: coin,
          blockNumber: 12n,
          logIndex: 8,
          transactionHash: tx,
          eventName: "FailedPull",
          args: { poolId: pool, epoch: 2n, account: holder, amount: 2n },
        },
      ],
      readers,
    );
    const epoch = store.epochs.get(`99801:${pool.toLowerCase()}:2`);
    assert.equal(epoch?.funded, 18n);
    assert.equal(epoch?.carry, 7n);
    assert.equal(epoch?.sealedAmount, 4n);
    assert.equal(store.payouts.size, 4);
    await store.forgetFrom(99801, 12n);
    assert.equal(store.epochs.has(`99801:${pool.toLowerCase()}:2`), false);
    assert.equal(store.balances.get(`99801:${pool.toLowerCase()}:${holder.toLowerCase()}`), 1_000n);
  });

  it("keeps a pre-IPO classification and drops a javascript website", async () => {
    const store = new MemoryStore();
    await ingest(
      store,
      99801,
      [
        {
          address: coin,
          blockNumber: 1n,
          logIndex: 1,
          transactionHash: `0x${"ab".repeat(32)}` as Hex,
          eventName: "CoinLaunched",
          args: {
            poolId: pool,
            coin,
            pair,
            mode: 0,
            isPlatform: false,
            feeRecipient: holder,
            teamWallet: zero,
            teamAmount: 0n,
            startMcap: 1n,
            category: 2,
            pairStatus: 1,
          },
        },
        {
          address: coin,
          blockNumber: 1n,
          logIndex: 2,
          transactionHash: `0x${"ac".repeat(32)}` as Hex,
          eventName: "PairClassified",
          args: { pair, status: 1, category: 2 },
        },
        {
          address: coin,
          blockNumber: 2n,
          logIndex: 1,
          transactionHash: `0x${"ad".repeat(32)}` as Hex,
          eventName: "MetadataPinned",
          args: { poolId: pool, cid: "bafyexample" },
        },
      ],
      {
        ...readers,
        async readMetadata() {
          return { description: "Space test", website: "javascript:alert(1)", x: "@space_x", telegram: "https://t.me/seedix" };
        },
      },
    );
    const row = store.coins.get(pool.toLowerCase());
    assert.equal(row?.category, 2);
    assert.equal(store.pairs.get(`99801:${pair.toLowerCase()}`)?.category, 2);
    assert.equal(row?.description, "Space test");
    assert.equal(row?.website, null);
    assert.equal(row?.xUrl, "https://x.com/space_x");
    assert.equal(row?.telegram, "https://t.me/seedix");
  });
});
