import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { buildPayableRound, conserves, GAS_CAP_BPS, planGas, WAD } from "./gas.ts";

const distributor = "0x00000000000000000000000000000000000000d1" as Address;
const coin = "0x00000000000000000000000000000000000000c0" as Address;
const pair = "0x0000000000000000000000000000000000000a11" as Address;
const alice = "0x00000000000000000000000000000000000000a1" as Address;
const bob = "0x00000000000000000000000000000000000000b2" as Address;

test("the gas reserve is capped at 1% and the rest is distributable", () => {
  const plan = planGas({
    pot: 10_000n,
    holderCount: 1n,
    gasPrice: 10n ** 18n,
    rewardPerHype: WAD,
    dust: 1n,
  });
  assert.equal(plan.cap, (10_000n * GAS_CAP_BPS) / 10_000n);
  assert.equal(plan.reserve, plan.cap);
  assert.equal(plan.distributable, 10_000n - plan.cap);
  assert.equal(conserves(plan.gross, plan.distributable, plan.cap, 0n), true);
});

test("a holder below the per-holder gas cost is left out and is not paid to someone else", () => {
  const pot = 10n * WAD;
  const built = buildPayableRound({
    chainId: 99801n,
    distributor,
    coin,
    pair,
    epoch: 1n,
    pot,
    dust: 1n,
    gasPrice: 100n * 10n ** 9n,
    rewardPerHype: WAD,
    rewardIsHype: true,
    holders: [
      { account: alice, balance: 10_000n },
      { account: bob, balance: 1n },
    ],
  });
  assert.equal(built.plan.unpriced, false);
  assert.ok(built.round);
  const claims = built.round.claims;
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.account.toLowerCase(), alice.toLowerCase());
  const aliceShare = (built.plan.distributable * 10_000n) / 10_001n;
  assert.equal(claims[0]?.amount, aliceShare);
  assert.ok(aliceShare < built.plan.distributable);
  assert.equal(aliceShare + (pot - aliceShare), pot);
});

test("an unpriced reward token does not build a round", () => {
  const built = buildPayableRound({
    chainId: 99801n,
    distributor,
    coin,
    pair,
    epoch: 1n,
    pot: 10_000n,
    dust: 1n,
    gasPrice: 1n,
    rewardPerHype: 0n,
    rewardIsHype: false,
    holders: [{ account: alice, balance: 1n }],
  });
  assert.equal(built.plan.unpriced, true);
  assert.equal(built.round, null);
});
