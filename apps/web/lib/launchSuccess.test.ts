import assert from "node:assert/strict";
import test from "node:test";
import { launchSuccess } from "./launchSuccess.ts";

test("a confirmed launch opens the coin page and resets the form", () => {
  const id = `0x${"ab".repeat(32)}`;
  assert.deepEqual(launchSuccess(id), { href: `/coin/${id}`, reset: true });
  assert.equal(launchSuccess(null), null);
  assert.equal(launchSuccess("0x1234"), null);
});
