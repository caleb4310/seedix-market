import assert from "node:assert/strict";
import test from "node:test";
import { initialSlippagePct, suggestedSlippage } from "./quote.ts";

test("the first three minutes default to 3 percent and a failed quote steps up", () => {
  assert.equal(initialSlippagePct(30), 3);
  assert.equal(initialSlippagePct(180), 1);
  assert.equal(suggestedSlippage(1), 4);
  assert.equal(suggestedSlippage(48), 50);
});
