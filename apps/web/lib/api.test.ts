import assert from "node:assert/strict";
import test from "node:test";
import { chartPath, coinFromApi, kickbackKind, portfolioPath, type ApiCoin } from "./api.ts";

const id = `0x${"ab".repeat(32)}`;

test("chart and portfolio paths stay on the validated id", () => {
  assert.equal(chartPath(id, "1h"), `/coins/${id}/chart?bucket=1h`);
  assert.equal(chartPath("kiln"), null);
  assert.equal(portfolioPath("0x4444444444444444444444444444444444444444"), "/portfolio/0x4444444444444444444444444444444444444444");
  assert.equal(portfolioPath("0x1234"), null);
});

test("an API coin becomes a board row", () => {
  const row: ApiCoin = {
    poolId: id,
    coin: "0x2222222222222222222222222222222222222222",
    pair: "0x3333333333333333333333333333333333333333",
    name: "Example",
    symbol: "EX",
    pairSymbol: "WHYPE",
    mode: "kickback",
    feeRecipient: "0x4444444444444444444444444444444444444444",
    launchTime: 1_700_000_000,
    price: "4",
    holders: 3,
  };
  const coin = coinFromApi(row);
  assert.equal(coin.ticker, "EX");
  assert.equal(coin.mode, "kickback");
  assert.equal(coin.price, 4);
  assert.equal(coin.mcap, undefined);
  assert.equal(coin.holders, 3);
  assert.equal(coin.poolId, id);
  assert.equal(kickbackKind("Pushed"), "Push");
  assert.equal(kickbackKind("ClaimableCredited"), "Claimable");
  assert.equal(kickbackKind("GasReimbursed"), "Gas");
  assert.equal(kickbackKind("FailedPull"), "Pulled");
});

test("the board cap is the raw start cap scaled into pair units", () => {
  const row: ApiCoin = {
    poolId: id,
    coin: "0x2222222222222222222222222222222222222222",
    pair: "0x3333333333333333333333333333333333333333",
    name: "Example",
    symbol: "EX",
    pairSymbol: "WHYPE",
    mode: "keep",
    feeRecipient: "0x4444444444444444444444444444444444444444",
    launchTime: 1_700_000_000,
    price: null,
    holders: 0,
    startMcap: (20_000n * 10n ** 18n).toString(),
    pairDecimals: 18,
    pairUsd: 1.5,
  };
  const coin = coinFromApi(row);
  assert.equal(coin.mcap, 20_000);
  assert.equal(coin.mcapUsd, 30_000);
  const usdc = coinFromApi({ ...row, startMcap: (2_500n * 10n ** 6n).toString(), pairDecimals: 6, pairUsd: null });
  assert.equal(usdc.mcap, 2_500);
  assert.equal(usdc.mcapUsd, null);
});
