import assert from "node:assert/strict";
import test from "node:test";
import { PRIORITY_FLOOR_WEI, transactionFees } from "@seedix/shared";

test("EIP-1559 max fee stays above a 0.1 gwei base fee when the RPC tip is zero", () => {
  const base = 100_000_000n;
  const fees = transactionFees({ baseFeePerGas: base, rpcTip: 0n });
  assert.equal("maxFeePerGas" in fees, true);
  if (!("maxFeePerGas" in fees)) return;
  assert.equal(fees.maxPriorityFeePerGas, PRIORITY_FLOOR_WEI);
  assert.ok(fees.maxFeePerGas > base);
  assert.equal(fees.maxFeePerGas, base * 2n + PRIORITY_FLOOR_WEI);
});

test("legacy gas price is bumped by a quarter", () => {
  assert.deepEqual(transactionFees({ baseFeePerGas: null, legacyGasPrice: 80n, priorityFloor: 1n }), { gasPrice: 100n });
});
