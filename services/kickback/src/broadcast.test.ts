import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { publishOnce, type EpochState } from "./broadcast.ts";
import { buildRound } from "./round.ts";

const pool = `0x${"ab".repeat(32)}` as Hex;
const distributor = "0x00000000000000000000000000000000000000d1" as Address;
const coin = "0x00000000000000000000000000000000000000c0" as Address;
const pair = "0x0000000000000000000000000000000000000a11" as Address;
const alice = "0x00000000000000000000000000000000000000a1" as Address;

function round() {
  const built = buildRound({
    chainId: 99801n,
    distributor,
    coin,
    pair,
    epoch: 1n,
    pot: 1000n,
    dust: 1n,
    holders: [{ account: alice, balance: 1n }],
  });
  if (!built) throw new Error("round");
  return built;
}

const empty: EpochState = {
  funded: 0n,
  postedAt: 0n,
  root: `0x${"00".repeat(32)}` as Hex,
  cancelled: false,
};

test("a crash after fund posts the root on the next run and does not fund again", async () => {
  const built = round();
  const sent: string[] = [];
  let latest: EpochState | null = null;
  let latestId = 0n;
  const send = async (step: { op: string; epoch?: bigint; root?: Hex }) => {
    sent.push(step.op);
    if (step.op === "fund") {
      latestId = 1n;
      latest = { funded: 1000n, postedAt: 0n, root: empty.root, cancelled: false };
    }
    if (step.op === "post" && step.root) {
      latest = { funded: 1000n, postedAt: 10n, root: step.root, cancelled: false };
    }
  };
  const first = await publishOnce({ dryRun: false, poolId: pool, pot: 1000n, latest, latestId, round: built, send });
  assert.equal(first.op, "fund");
  const second = await publishOnce({ dryRun: false, poolId: pool, pot: 0n, latest, latestId, round: built, send });
  assert.equal(second.op, "post");
  const third = await publishOnce({ dryRun: false, poolId: pool, pot: 1000n, latest, latestId, round: built, send });
  assert.equal(third.op, "skip");
  assert.deepEqual(sent, ["fund", "post"]);
});

test("a paid batch is not sent again, and the next batch resumes", async () => {
  const bob = "0x00000000000000000000000000000000000000b2" as Address;
  const built = buildRound({
    chainId: 99801n,
    distributor,
    coin,
    pair,
    epoch: 1n,
    pot: 1000n,
    dust: 1n,
    holders: [
      { account: alice, balance: 1n },
      { account: bob, balance: 1n },
    ],
  });
  if (!built) throw new Error("round");
  const root = built.root;
  const latest: EpochState = { funded: 1000n, postedAt: 5n, root, cancelled: false };
  const sent: string[][] = [];
  const claimed = new Set<string>([alice.toLowerCase()]);
  const first = await publishOnce({
    dryRun: false,
    poolId: pool,
    pot: 0n,
    latest,
    latestId: 1n,
    round: built,
    claimed,
    reviewOpen: true,
    sealed: false,
    send: async (step) => {
      if (step.op !== "push") return;
      sent.push(step.accounts.map((account) => account.toLowerCase()));
      for (const account of step.accounts) claimed.add(account.toLowerCase());
    },
  });
  assert.equal(first.op, "push");
  assert.deepEqual(sent, [[bob.toLowerCase()]]);
  const second = await publishOnce({
    dryRun: true,
    poolId: pool,
    pot: 0n,
    latest,
    latestId: 1n,
    round: built,
    claimed,
    reviewOpen: true,
    sealed: false,
    send: async () => {
      throw new Error("already paid");
    },
  });
  assert.equal(second.op, "seal");
});

test("an unpriced reward token is not broadcast", async () => {
  const built = round();
  const step = await publishOnce({
    dryRun: false,
    poolId: pool,
    pot: 1000n,
    latest: null,
    latestId: 0n,
    round: built,
    unpriced: true,
    send: async () => {
      throw new Error("should not send");
    },
  });
  assert.equal(step.op, "skip");
});

test("dry-run does not send", async () => {
  const built = round();
  let calls = 0;
  const step = await publishOnce({
    dryRun: true,
    poolId: pool,
    pot: 1000n,
    latest: null,
    latestId: 0n,
    round: built,
    send: async () => {
      calls += 1;
    },
  });
  assert.equal(step.op, "fund");
  assert.equal(calls, 0);
});
