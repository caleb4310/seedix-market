import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { LAUNCH_SUPPLY } from "@seedix/shared";
import { coinFromLaunch, type LaunchedRead } from "./launched.ts";

const id = `0x${"ab".repeat(32)}`;

function read(over: Partial<LaunchedRead> = {}): LaunchedRead {
  return {
    coin: "0x2222222222222222222222222222222222222222",
    pair: "0x3333333333333333333333333333333333333333",
    mode: 1,
    isPlatform: false,
    launchTime: 1_700_000_000,
    feeRecipient: "0x4444444444444444444444444444444444444444" as Address,
    name: "Example",
    symbol: "EX",
    pairSymbol: "WHYPE",
    pairDecimals: 18,
    coinIsToken0: true,
    startMcap: 20_000n * 10n ** 18n,
    metadataCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    poolLive: true,
    category: "crypto",
    ...over,
  };
}

test("a chain read shows the starting cap before the indexer stores the coin", () => {
  const coin = coinFromLaunch(id, read({ sqrtPriceX96: 1n << 96n, supplyRaw: LAUNCH_SUPPLY }));
  assert.equal(coin?.startMcap, 20_000);
  assert.equal(coin?.mcap, 1_000_000_000);
  assert.notEqual(coin?.mcap, coin?.startMcap);
  assert.equal(coin?.pair, "WHYPE");
  assert.equal(coin?.ticker, "EX");
  assert.equal(coin?.mode, "kickback");
  assert.equal(coinFromLaunch(id, read({ coin: "0x0000000000000000000000000000000000000000" })), null);
  assert.equal(coinFromLaunch("not-a-pool", read()), null);
});

test("a six-decimal pair is not shown as 18-decimal wei", () => {
  const coin = coinFromLaunch(id, read({ pairSymbol: "USDC", pairDecimals: 6, startMcap: 2_500n * 10n ** 6n }));
  assert.equal(coin?.startMcap, 2_500);
  assert.equal(coin?.mcap, undefined);
  assert.equal(coin?.pair, "USDC");
});
