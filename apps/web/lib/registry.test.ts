import assert from "node:assert/strict";
import test from "node:test";
import { pairTabLabel, withChainSymbols, type ListedPair } from "./registry.ts";

const bare: ListedPair = {
  address: "0x314CBAf340A02188B06A08b3458499c6d0d24189",
  status: 1,
  category: "stock",
  symbol: "",
  name: "",
  logo: null,
  usd: null,
  test: false,
};

test("a pair tab uses symbol() when the token list has no name", async () => {
  const [filled] = await withChainSymbols([bare], async () => "wNVDAx");
  assert.equal(filled?.symbol, "wNVDAx");
  assert.equal(filled?.name, "wNVDAx");
  assert.equal(pairTabLabel(filled ?? bare), "wNVDAx");
});

test("a listed symbol is kept, and a failed read does not blank the tab", async () => {
  const named = { ...bare, symbol: "USDC", name: "USD Coin" };
  const [kept] = await withChainSymbols([named], async () => {
    throw new Error("rpc");
  });
  assert.equal(kept?.symbol, "USDC");
  const [missed] = await withChainSymbols([bare], async () => {
    throw new Error("rpc");
  });
  assert.equal(missed?.symbol, "");
  assert.equal(pairTabLabel(missed ?? bare), "0x314C…4189");
});
