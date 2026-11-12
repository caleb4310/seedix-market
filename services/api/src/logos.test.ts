import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  LOGO_PENDING_WINDOW_SEC,
  attachLogo,
  claimPending,
  loadableLogo,
  logoFor,
  publicLogoUrl,
  rememberPending,
} from "./logos.ts";

const pool = `0x${"ab".repeat(32)}`;
const otherPool = `0x${"cd".repeat(32)}`;
const creator = `0x${"11".repeat(20)}`;
const stranger = `0x${"22".repeat(20)}`;
const launch = 1_700_000_000;
const url = "/api/logos/abc.png";

describe("logos", { concurrency: false }, () => {
  it("stores logos where the web can load them and refuses a bad pool or url", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seedix-logos-"));
    const previous = process.env.LOGOS_DIR;
    process.env.LOGOS_DIR = dir;
    try {
      assert.equal(publicLogoUrl("abc.png"), "/api/logos/abc.png");
      assert.equal(loadableLogo("/logos/abc.png"), "/api/logos/abc.png");
      assert.equal(loadableLogo("/api/logos/abc.png"), "/api/logos/abc.png");
      assert.equal(attachLogo(pool, "/logos/abc.png"), true);
      assert.equal(logoFor(pool), "/api/logos/abc.png");
      assert.equal(attachLogo(pool, publicLogoUrl("def.png")), true);
      assert.equal(logoFor(pool), "/api/logos/def.png");
      assert.equal(attachLogo("0x1234", url), false);
      assert.equal(attachLogo(pool, "https://evil.example/a.png"), false);
      assert.equal(logoFor(pool), "/api/logos/def.png");
    } finally {
      if (previous === undefined) delete process.env.LOGOS_DIR;
      else process.env.LOGOS_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads an index that appears after the first lookup", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seedix-logos-"));
    const previous = process.env.LOGOS_DIR;
    process.env.LOGOS_DIR = dir;
    try {
      assert.equal(logoFor(pool), null);
      await writeFile(path.join(dir, "index.json"), JSON.stringify({ [pool]: url }));
      assert.equal(logoFor(pool), url);
      await writeFile(path.join(dir, "index.json"), JSON.stringify({ [pool]: "/api/logos/next.png" }));
      assert.equal(logoFor(pool), "/api/logos/next.png");
    } finally {
      if (previous === undefined) delete process.env.LOGOS_DIR;
      else process.env.LOGOS_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("auto-attaches a pending logo only to the upload signer's new pool", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seedix-logos-"));
    const previous = process.env.LOGOS_DIR;
    process.env.LOGOS_DIR = dir;
    try {
      assert.equal(rememberPending(creator, url, (launch - 30) * 1000), true);
      assert.equal(claimPending({ poolId: otherPool, feeRecipient: stranger, launchTime: launch }), false);
      assert.equal(logoFor(otherPool), null);
      assert.equal(claimPending({ poolId: pool, feeRecipient: stranger, launchTime: launch }), false);
      assert.equal(logoFor(pool), null);
      assert.equal(
        claimPending({ poolId: pool, feeRecipient: creator, launchTime: launch - 30 - LOGO_PENDING_WINDOW_SEC - 5 }),
        false,
      );
      assert.equal(claimPending({ poolId: pool, feeRecipient: creator, launchTime: launch - 120 }), false);
      assert.equal(claimPending({ poolId: pool, feeRecipient: creator, launchTime: launch - 200 }), false);
      assert.equal(logoFor(pool), null);
      assert.equal(claimPending({ poolId: pool, feeRecipient: creator, launchTime: launch }), true);
      assert.equal(logoFor(pool), url);
      assert.equal(claimPending({ poolId: otherPool, feeRecipient: creator, launchTime: launch + 10 }), false);
      assert.equal(logoFor(otherPool), null);
    } finally {
      if (previous === undefined) delete process.env.LOGOS_DIR;
      else process.env.LOGOS_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
