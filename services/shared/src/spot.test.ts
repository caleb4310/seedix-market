import assert from "node:assert/strict";
import test from "node:test";
import { coinPrice, LAUNCH_SUPPLY, marketCapFromSpot } from "./spot.ts";

test("a sqrt price of 1 is one raw pair unit per raw coin", () => {
  assert.equal(coinPrice(1n << 96n, true), "1");
  assert.equal(coinPrice(1n << 96n, false), "1");
});

test("live market cap is price times supply, not the starting cap", () => {
  const start = marketCapFromSpot("0.00002", LAUNCH_SUPPLY, 18);
  assert.equal(start, "20000");
  const traded = marketCapFromSpot("0.00004", LAUNCH_SUPPLY, 18);
  assert.equal(traded, "40000");
  assert.notEqual(traded, start);
  assert.equal(marketCapFromSpot("0", LAUNCH_SUPPLY, 18), null);
});

test("pair decimals change the human cap of the same raw price", () => {
  assert.equal(marketCapFromSpot("0.02", LAUNCH_SUPPLY, 18), "20000000");
  assert.equal(marketCapFromSpot("0.02", LAUNCH_SUPPLY, 6), "20000000000000000000");
});
