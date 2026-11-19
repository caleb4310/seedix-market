import assert from "node:assert/strict";
import test from "node:test";
import { zroRemoteClaimEnabled, zroTaxEnabled } from "./flags.ts";

test("ZRO tax is on for Base Sepolia, off for Elysium, and the remote claim stays off", () => {
  const chain = process.env.NEXT_PUBLIC_CHAIN_ID;
  const tax = process.env.NEXT_PUBLIC_ZRO_TAX_ENABLED;
  const remote = process.env.NEXT_PUBLIC_ZRO_REMOTE_CLAIM_ENABLED;
  delete process.env.NEXT_PUBLIC_ZRO_TAX_ENABLED;
  delete process.env.NEXT_PUBLIC_ZRO_REMOTE_CLAIM_ENABLED;
  process.env.NEXT_PUBLIC_CHAIN_ID = "84532";
  assert.equal(zroTaxEnabled(), true);
  process.env.NEXT_PUBLIC_CHAIN_ID = "99801";
  assert.equal(zroTaxEnabled(), false);
  process.env.NEXT_PUBLIC_ZRO_TAX_ENABLED = "false";
  process.env.NEXT_PUBLIC_CHAIN_ID = "84532";
  assert.equal(zroTaxEnabled(), false);
  assert.equal(zroRemoteClaimEnabled(), false);
  if (chain === undefined) delete process.env.NEXT_PUBLIC_CHAIN_ID;
  else process.env.NEXT_PUBLIC_CHAIN_ID = chain;
  if (tax === undefined) delete process.env.NEXT_PUBLIC_ZRO_TAX_ENABLED;
  else process.env.NEXT_PUBLIC_ZRO_TAX_ENABLED = tax;
  if (remote === undefined) delete process.env.NEXT_PUBLIC_ZRO_REMOTE_CLAIM_ENABLED;
  else process.env.NEXT_PUBLIC_ZRO_REMOTE_CLAIM_ENABLED = remote;
});
