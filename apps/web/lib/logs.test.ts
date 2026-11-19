import assert from "node:assert/strict";
import test from "node:test";
import { LOG_SPAN, logRanges } from "./logs.ts";

test("log windows stay inside the public RPC block cap", () => {
  const from = 60_147_699n;
  const to = from + 90_000n;
  const ranges = logRanges(from, to);
  assert.equal(ranges.length, 3);
  assert.equal(ranges[0]?.from, from);
  assert.equal(ranges[0]?.to, from + LOG_SPAN - 1n);
  assert.equal(ranges.at(-1)?.to, to);
  for (const range of ranges) assert.ok(range.to - range.from + 1n <= 50_000n);
});

test("an empty or backwards range returns no windows", () => {
  assert.deepEqual(logRanges(10n, 9n), []);
});
