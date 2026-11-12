import assert from "node:assert/strict";
import test from "node:test";
import { capTransactionFees, priorityFloorWei, PRIORITY_FLOOR_WEI, transactionFees } from "./fees.ts";

const base = 100_000_000n;

test("a zero tip still leaves headroom over the base fee", () => {
  const fees = transactionFees({ baseFeePerGas: base, rpcTip: 0n });
  assert.ok("maxFeePerGas" in fees);
  if (!("maxFeePerGas" in fees)) return;
  assert.equal(fees.maxPriorityFeePerGas, PRIORITY_FLOOR_WEI);
  assert.equal(fees.maxFeePerGas, base * 2n + PRIORITY_FLOOR_WEI);
  assert.ok(fees.maxFeePerGas > base);
});

test("an RPC tip above the floor is kept", () => {
  const tip = 5_000_000n;
  const fees = transactionFees({ baseFeePerGas: base, rpcTip: tip, priorityFloor: PRIORITY_FLOOR_WEI });
  assert.ok("maxPriorityFeePerGas" in fees);
  if (!("maxPriorityFeePerGas" in fees)) return;
  assert.equal(fees.maxPriorityFeePerGas, tip);
  assert.equal(fees.maxFeePerGas, base * 2n + tip);
});

test("a chain without a base fee uses gas price times 1.25, and never below the floor", () => {
  const bumped = transactionFees({ baseFeePerGas: null, legacyGasPrice: 100n, priorityFloor: 1n });
  assert.deepEqual(bumped, { gasPrice: 125n });
  const tiny = transactionFees({ baseFeePerGas: null, legacyGasPrice: 1n, priorityFloor: 10n });
  assert.deepEqual(tiny, { gasPrice: 10n });
});

test("the priority floor is configurable and rejects junk", () => {
  assert.equal(priorityFloorWei("42"), 42n);
  assert.equal(priorityFloorWei(""), PRIORITY_FLOOR_WEI);
  assert.equal(priorityFloorWei("0"), PRIORITY_FLOOR_WEI);
  assert.equal(priorityFloorWei("nope"), PRIORITY_FLOOR_WEI);
});

test("a fee cap does not pull the max fee under the base fee", () => {
  const fees = transactionFees({ baseFeePerGas: base, rpcTip: 0n });
  const roomy = capTransactionFees(fees, base * 10n, base);
  assert.deepEqual(roomy, fees);
  const tight = capTransactionFees(fees, base + PRIORITY_FLOOR_WEI, base);
  assert.ok("maxFeePerGas" in tight);
  if (!("maxFeePerGas" in tight)) return;
  assert.equal(tight.maxFeePerGas, base + PRIORITY_FLOOR_WEI);
  assert.ok(tight.maxFeePerGas > base);
  const tooLow = capTransactionFees(fees, base, base);
  assert.deepEqual(tooLow, fees);
});
