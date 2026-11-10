import assert from "node:assert/strict";
import test from "node:test";
import { priceLabel } from "./priceLabel.ts";

test("a pair price keeps the pair symbol and does not use a dollar sign", () => {
  assert.deepEqual(priceLabel("wNVDAx", null), { dollar: false, suffix: " wNVDAx" });
  assert.deepEqual(priceLabel("wNVDAx", undefined), { dollar: false, suffix: " wNVDAx" });
  assert.deepEqual(priceLabel("USDC", 1), { dollar: true, suffix: "" });
});
