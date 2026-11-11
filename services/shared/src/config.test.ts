import assert from "node:assert/strict";
import test from "node:test";
import { configuredChainId, requiredAddress } from "./config.ts";

test("chain id comes from the environment", () => {
  assert.equal(configuredChainId({ CHAIN_ID: "99901" }), 99901);
  assert.equal(configuredChainId({ NEXT_PUBLIC_CHAIN_ID: "31337" }), 31337);
  assert.throws(() => configuredChainId({}), /CHAIN_ID is required/);
});

test("a missing contract address does not fall back", () => {
  assert.equal(requiredAddress("HOOK_ADDRESS", { HOOK_ADDRESS: "0x0000000000000000000000000000000000000001" }), "0x0000000000000000000000000000000000000001");
  assert.throws(() => requiredAddress("HOOK_ADDRESS", {}), /HOOK_ADDRESS is required/);
});
