import assert from "node:assert/strict";
import test from "node:test";
import { candles, epochSeconds } from "./chart.ts";

test("chart buckets treat milliseconds as seconds", () => {
  assert.equal(epochSeconds(1_794_303_803), 1_794_303_803);
  assert.equal(epochSeconds(1_794_303_803_000), 1_794_303_803);
  const rows = candles(
    [
      { t: 1_794_303_803_000, price: "1", volume: 1n },
      { t: 1_794_303_820_000, price: "2", volume: 1n },
    ],
    300,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.close, "2");
});
