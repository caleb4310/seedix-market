import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_START_WEI, formatUsdCompact, launchCapLabel, startWhypeFromChain, whypeAmount } from "./startCap.ts";

test("34 WHYPE at $74.6 is about $2.5K", () => {
  assert.equal(whypeAmount(DEFAULT_START_WEI), 34);
  assert.equal(formatUsdCompact(34 * 74.6), "$2.5K");
  assert.equal(launchCapLabel(74.6), "$2.5K MC");
});

test("a missing quote does not invent a dollar or a token amount", () => {
  assert.equal(launchCapLabel(null), "USD price unavailable");
  assert.equal(launchCapLabel(0), "USD price unavailable");
  assert.equal(launchCapLabel(Number.NaN), "USD price unavailable");
});

test("the chain default wins when it is set", () => {
  assert.equal(startWhypeFromChain(undefined), DEFAULT_START_WEI);
  assert.equal(startWhypeFromChain(0n), DEFAULT_START_WEI);
  assert.equal(startWhypeFromChain(40n * 10n ** 18n), 40n * 10n ** 18n);
});

test("compact dollars stay short", () => {
  assert.equal(formatUsdCompact(185_000), "$185K");
  assert.equal(formatUsdCompact(1_500_000), "$1.5M");
  assert.equal(formatUsdCompact(12), "$12.00");
  assert.equal(formatUsdCompact(0.00004), "<$0.0001");
  assert.equal(formatUsdCompact(0.034), "$0.034");
});
