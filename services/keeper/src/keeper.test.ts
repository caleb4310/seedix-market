import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { assertKeyFile, keyFilePath, loadKey } from "./key.ts";
import { buildTree, kickbackLeaf, preparePush, verifyProof, type Manifest } from "./merkle.ts";
import { parseManifest } from "./index.ts";
import { amountSteps, feeWithinCap, planCoinBuyback, pushBatches, pushReady } from "./plan.ts";
import { revertLabel } from "./reason.ts";

const distributor = "0x1111111111111111111111111111111111111111" as const;
const coin = "0x2222222222222222222222222222222222222222" as const;
const pair = "0x3333333333333333333333333333333333333333" as const;
const a = "0x4444444444444444444444444444444444444444" as const;
const b = "0x5555555555555555555555555555555555555555" as const;
const c = "0x6666666666666666666666666666666666666666" as const;

describe("keeper key", () => {
  it("accepts a root-only file and a Docker secret, and refuses the working tree", () => {
    assert.doesNotThrow(() => assertKeyFile("/etc/seedix/keeper.key", 0o100600, 0));
    assert.doesNotThrow(() => assertKeyFile("/run/secrets/keeper_key", 0o444, 0));
    assert.throws(() => assertKeyFile("/etc/seedix/keeper.key", 0o640, 0), /mode 600/);
    assert.throws(() => assertKeyFile("/etc/seedix/keeper.key", 0o600, 1000), /mode 600/);
    assert.throws(() => assertKeyFile("/run/secrets/keeper_key", 0o666, 0), /writable/);
    assert.throws(() => assertKeyFile(path.join(process.cwd(), "keeper.key"), 0o600, 0), /working tree/);
  });

  it("does not repeat a bad file in the error", () => {
    const secret = "not-a-key-SECRET";
    assert.throws(() => loadKey(secret), /hex private key/);
    try {
      loadKey(secret);
    } catch (err) {
      assert.equal(String(err).includes(secret), false);
    }
    assert.equal(loadKey(`  ${"ab".repeat(32)}\n`), `0x${"ab".repeat(32)}`);
  });

  it("reads the key from a path and refuses a raw key in the environment", () => {
    assert.equal(keyFilePath({ KEEPER_PRIVATE_KEY: "/run/secrets/keeper_key" }), "/run/secrets/keeper_key");
    assert.equal(keyFilePath({ KEEPER_KEY_FILE: "/etc/seedix/keeper.key" }), "/etc/seedix/keeper.key");
    assert.throws(() => keyFilePath({ KEEPER_PRIVATE_KEY: `0x${"ab".repeat(32)}` }), /file path/);
  });
});

describe("revert labels", () => {
  it("keeps the reason line viem prints under the signature sentence", () => {
    const err = new Error('The contract function "convertAccrued" reverted with the following signature:\nNothing()');
    assert.equal(revertLabel(err), "Nothing()");
    assert.equal(revertLabel({ data: { errorName: "RouteNotRegistered" } }), "RouteNotRegistered");
  });
});

describe("buyback plan", () => {
  it("waits out the interval and steps the size down from the pot", () => {
    assert.deepEqual(planCoinBuyback(10n, 40n, 1_000n, 1_200n), []);
    assert.deepEqual(planCoinBuyback(10n, 40n, 1_000n, 1_300n), [10n, 5n, 2n, 1n]);
    assert.equal(planCoinBuyback(100n, 40n, 0n, 1_300n)[0], 40n);
    assert.deepEqual(amountSteps(0n), []);
    assert.equal(pushReady(0n, 10_000n, false), false);
    assert.equal(pushReady(1_000n, 4_599n, false), false);
    assert.equal(pushReady(1_000n, 4_600n, false), true);
    assert.equal(pushReady(1_000n, 9_000n, true), false);
    assert.equal(feeWithinCap(200_000n, 20n * 10n ** 9n, 100n * 10n ** 9n, 12_000_000n), true);
    assert.equal(feeWithinCap(200_000n, 200n * 10n ** 9n, 100n * 10n ** 9n, 12_000_000n), false);
    assert.equal(feeWithinCap(13_000_000n, 1n, 10n ** 30n, 12_000_000n), false);
    assert.equal(pushBatches([1, 2, 3], 2).length, 2);
    assert.equal(pushBatches(new Array(40).fill(0)).length, 2);
  });
});

describe("kickback manifest", () => {
  it("builds a tree the posted root can verify, and rejects a different root", () => {
    const claims = [
      { account: a, amount: 1n },
      { account: b, amount: 2n },
      { account: c, amount: 3n },
    ];
    const leaves = claims.map((claim) =>
      kickbackLeaf({ chainId: 99801n, distributor, coin, pair, epoch: 1n, account: claim.account, amount: claim.amount }),
    );
    const tree = buildTree(leaves);
    for (let i = 0; i < leaves.length; i += 1) {
      const leaf = leaves[i];
      const proof = tree.proofs[i];
      assert.ok(leaf && proof && verifyProof(tree.root, leaf, proof));
    }
    const manifest: Manifest = { poolId: `0x${"11".repeat(32)}`, epoch: 1n, chainId: 99801n, distributor, coin, pair, claims };
    const prepared = preparePush(manifest, tree.root);
    assert.equal(prepared?.accounts.length, 3);
    assert.equal(preparePush(manifest, `0x${"00".repeat(32)}`), null);
    assert.equal(parseManifest("{"), null);
  });
});
