import assert from "node:assert/strict";
import test from "node:test";
import { backingLabel } from "./backing.ts";

test("the pill is the backing token, and burn never says WHYPE", () => {
  assert.equal(backingLabel({ mode: "keep", pair: "WHYPE", backingSymbol: "wNVDAx" }), "wNVDAx");
  assert.equal(backingLabel({ mode: "kickback", pair: "WHYPE", backingSymbol: "wSPYx" }), "wSPYx");
  assert.equal(backingLabel({ mode: "burn", pair: "WHYPE", backingSymbol: "wNVDAx" }), "Burn");
  assert.equal(backingLabel({ mode: "keep", pair: "WHYPE" }), "—");
  assert.equal(
    backingLabel({ mode: "keep", pair: "WHYPE", backing: "0x57259fc209118a87bbb788168f4f8df9f2e77c6d" }),
    "0x5725…7c6d",
  );
  assert.equal(backingLabel({ mode: "keep", pair: "wQQQx" }), "wQQQx");
});
