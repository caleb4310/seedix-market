import assert from "node:assert/strict";
import test from "node:test";
import { claimNotice } from "./claims.ts";

test("a disconnected wallet is not told that proofs are loading", () => {
  assert.equal(claimNotice(false, true, null), "Connect a wallet to see claims.");
  assert.equal(claimNotice(true, true, null), "Loading claim proofs.");
  assert.equal(claimNotice(true, true, 0), "No merkle claim is waiting for this wallet.");
  assert.equal(claimNotice(true, true, 2), null);
});
