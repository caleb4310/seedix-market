import assert from "node:assert/strict";
import test from "node:test";
import { activeChain, baseSepolia, elysiumTestnet } from "./chains.ts";

test("Base Sepolia is the default and Elysium stays selectable", () => {
  const base = activeChain({});
  assert.equal(base.id, baseSepolia.id);
  assert.equal(base.nativeCurrency.symbol, "ETH");
  assert.equal(base.priceId, "ethereum");
  assert.equal(base.zroTax, true);
  assert.equal(base.startBlock, 60147699);
  const elysium = activeChain({ CHAIN_ID: "99801" });
  assert.equal(elysium.id, elysiumTestnet.id);
  assert.equal(elysium.nativeCurrency.symbol, "HYPE");
  assert.equal(elysium.priceId, "hyperliquid");
  assert.equal(elysium.zroTax, false);
});

test("an explicit symbol overrides the preset", () => {
  const chain = activeChain({ CHAIN_ID: "84532", NATIVE_CURRENCY_SYMBOL: "ETH" });
  assert.equal(chain.nativeCurrency.symbol, "ETH");
});
