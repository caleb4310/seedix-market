import assert from "node:assert/strict";
import test from "node:test";
import { backingLabel } from "./backing.ts";

test("the pill is the backing token, and burn never says WHYPE", () => {
  assert.equal(backingLabel({ mode: "keep", pair: "WHYPE", backingSymbol: "wNVDAx" }), "wNVDAx");
  assert.equal(backingLabel({ mode: "kickback", pair: "WHYPE", backingSymbol: "wSPYx" }), "wSPYx");
  assert.equal(backingLabel({ mode: "burn", pair: "WHYPE", backingSymbol: "wNVDAx" }), "Burn");
  assert.equal(backingLabel({ mode: "keep", pair: "WHYPE" }), "Backing");
  assert.equal(backingLabel({ mode: "keep", pair: "wQQQx" }), "wQQQx");
});
