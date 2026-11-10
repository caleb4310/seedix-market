import assert from "node:assert/strict";
import test from "node:test";
import { priceLabel, spotFigure } from "./priceLabel.ts";

test("a pair price keeps the pair symbol and does not use a dollar sign", () => {
  assert.deepEqual(priceLabel("wNVDAx", null), { dollar: false, suffix: " wNVDAx" });
  assert.deepEqual(priceLabel("wNVDAx", undefined), { dollar: false, suffix: " wNVDAx" });
  assert.deepEqual(priceLabel("HYPE", 1), { dollar: true, suffix: " · HYPE" });
});

test("a 3.4e-8 token price is subscript zeros, not scientific notation", () => {
  const fig = spotFigure(0.00000003446);
  assert.equal(fig.kind, "sub");
  if (fig.kind === "sub") {
    assert.equal(fig.zeros, 7);
    assert.equal(fig.text.startsWith("3446"), true);
  }
  assert.equal(JSON.stringify(spotFigure(0.00000003446)).includes("e-"), false);
});
