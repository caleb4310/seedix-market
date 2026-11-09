import assert from "node:assert/strict";
import test from "node:test";
import { formatTokenAmount, minimumFromQuote, parseTokenAmount } from "./amounts.ts";

test("18 decimal amounts stay exact", () => {
  const parsed = parseTokenAmount("1.5", 18);
  assert.equal(parsed, 1_500_000_000_000_000_000n);
  assert.equal(formatTokenAmount(parsed, 18), "1.5");
});

test("6 decimal amounts are not scaled to 18", () => {
  const parsed = parseTokenAmount("100", 6);
  assert.equal(parsed, 100_000_000n);
  assert.notEqual(parsed, parseTokenAmount("100", 18));
  assert.equal(formatTokenAmount(parsed, 6), "100");
});

test("a leading dot is half a token", () => {
  assert.equal(parseTokenAmount(".5", 18), 500_000_000_000_000_000n);
  assert.equal(parseTokenAmount(".5", 6), 500_000n);
});

test("minimum received uses the typed slippage", () => {
  const quote = parseTokenAmount("1000", 18);
  assert.equal(minimumFromQuote(quote, 1), parseTokenAmount("990", 18));
  assert.equal(minimumFromQuote(quote, 5), parseTokenAmount("950", 18));
});
