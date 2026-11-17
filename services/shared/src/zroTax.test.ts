import assert from "node:assert/strict";
import test from "node:test";
import { creatorBpsFromPercent, reportedZroTax, zroTaxLabel } from "./zroTax.ts";

test("ON_TOP is the default and the trader pays creator plus 1%", () => {
  const tax = reportedZroTax({ enabled: true, creatorTaxBps: 500 });
  assert.equal(tax.feeMode, "on_top");
  assert.equal(tax.protocolFeeBps, 100);
  assert.equal(tax.effectiveTaxBps, 600);
  assert.equal(zroTaxLabel(tax), "ZRO tax 6% (5% to holders + 1% Seedix)");
});

test("FROM_CREATOR_TAX does not add a second percent on the trader", () => {
  const tax = reportedZroTax({ enabled: true, creatorTaxBps: 500, protocolFeeBps: 100, feeMode: "from_creator_tax" });
  assert.equal(tax.effectiveTaxBps, 500);
  assert.match(zroTaxLabel(tax), /taken from the creator tax/);
});

test("a pool that has not turned ZRO on does not show a phantom 1%", () => {
  const tax = reportedZroTax({});
  assert.equal(tax.enabled, false);
  assert.equal(tax.effectiveTaxBps, 0);
  assert.equal(tax.feeMode, "on_top");
});

test("the launch field rejects a creator rate that would push the total over 10%", () => {
  assert.deepEqual(creatorBpsFromPercent("9"), { ok: true, bps: 900 });
  assert.deepEqual(creatorBpsFromPercent(""), { ok: true, bps: 0 });
  const tooHigh = creatorBpsFromPercent("9.01");
  assert.equal(tooHigh.ok, false);
});
