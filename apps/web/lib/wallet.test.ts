import assert from "node:assert/strict";
import test from "node:test";
import { walletConnectProjectId } from "./wallet.ts";

test("empty and placeholder project ids stay hidden", () => {
  assert.equal(walletConnectProjectId(undefined), "");
  assert.equal(walletConnectProjectId(""), "");
  assert.equal(walletConnectProjectId("   "), "");
  assert.equal(walletConnectProjectId("replace-with-walletconnect-project-id"), "");
  assert.equal(walletConnectProjectId("seedix-injected-only"), "");
});

test("a 32 hex project id is kept", () => {
  const id = "0123456789abcDEFfedcba9876543210";
  assert.equal(walletConnectProjectId(id), id);
  assert.equal(walletConnectProjectId(`  ${id}  `), id);
});
