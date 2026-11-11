import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { buildRound, leaf, verifyProof } from "./round.ts";

const distributor = "0x00000000000000000000000000000000000000d1" as Address;
const coin = "0x00000000000000000000000000000000000000c0" as Address;
const pair = "0x0000000000000000000000000000000000000a11" as Address;
const alice = "0x00000000000000000000000000000000000000a1" as Address;
const bob = "0x00000000000000000000000000000000000000b0" as Address;
const dead = "0x000000000000000000000000000000000000dEaD" as Address;

test("a round splits the pot and every proof matches the root", () => {
  const round = buildRound({
    chainId: 99801n,
    distributor,
    coin,
    pair,
    epoch: 4n,
    pot: 1000n,
    dust: 1n,
    holders: [
      { account: alice, balance: 1n },
      { account: bob, balance: 3n },
      { account: dead, balance: 100n },
    ],
    excluded: ["0x0000000000000000000000000000000000000001"],
  });
  assert.ok(round);
  if (!round) return;
  assert.equal(round.claims.length, 2);
  assert.equal(round.claims.find((claim) => claim.account === bob)?.amount, 750n);
  assert.equal(round.claims.find((claim) => claim.account === alice)?.amount, 250n);
  round.claims.forEach((claim, index) => {
    const hash = leaf({
      chainId: round.chainId,
      distributor,
      coin,
      pair,
      epoch: round.epoch,
      account: claim.account,
      amount: claim.amount,
    });
    assert.equal(verifyProof(round.root, hash, round.proofs[index] ?? []), true);
  });
});

test("dust and an empty snapshot produce no round", () => {
  assert.equal(
    buildRound({
      chainId: 99801n,
      distributor,
      coin,
      pair,
      epoch: 1n,
      pot: 10n,
      dust: 100n,
      holders: [{ account: alice, balance: 1n }],
    }),
    null,
  );
});
