import assert from "node:assert/strict";
import test from "node:test";
import { bindLaunchLogo, canAddLogo, retryLogo } from "./logoRetry.ts";

const creator = "0x1111111111111111111111111111111111111111";
const stranger = "0x2222222222222222222222222222222222222222";
const pool = `0x${"ab".repeat(32)}` as const;
const oldPool = `0x${"cd".repeat(32)}`;

test("add logo is offered only to the creator of a coin with no image", () => {
  assert.equal(canAddLogo({ connected: creator, recipient: creator, image: null }), true);
  assert.equal(canAddLogo({ connected: creator, creator, recipient: stranger, image: null }), true);
  assert.equal(canAddLogo({ connected: stranger, recipient: creator, image: null }), false);
  assert.equal(canAddLogo({ connected: creator, recipient: creator, image: "/api/logos/a.png" }), false);
  assert.equal(canAddLogo({ recipient: creator, image: null }), false);
});

test("the token page retry uploads and then attaches that pool", async () => {
  const calls: { url: string; body?: string }[] = [];
  const signed: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.includes("/logos/nonce")) {
      const n = calls.filter((call) => call.url.includes("/logos/nonce")).length - 1;
      return Response.json({ nonce: String(n) });
    }
    if (url.endsWith("/logos")) return Response.json({ url: "/api/logos/abc.png" }, { status: 201 });
    if (url.endsWith("/logos/attach")) return Response.json({ ok: true });
    return new Response("no", { status: 404 });
  };
  const result = await retryLogo({
    apiUrl: "http://api.test",
    poolId: pool,
    address: creator,
    bytes: new Uint8Array([1, 2, 3]),
    sign: async (typed) => {
      signed.push(typed.primaryType);
      return "0xsig";
    },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.url, "/api/logos/abc.png");
  assert.deepEqual(signed, ["LogoUpload", "LogoAttach"]);
  const attach = calls.find((call) => call.url.endsWith("/logos/attach"));
  const body = JSON.parse(attach?.body ?? "{}") as { poolId: string; url: string };
  assert.equal(body.poolId, pool);
  assert.equal(body.url, "/api/logos/abc.png");
});

test("a rejected upload does not attach a logo", async () => {
  let attached = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/logos/nonce")) return Response.json({ nonce: "0" });
    if (url.endsWith("/logos")) return Response.json({ error: "bad signature" }, { status: 401 });
    attached += 1;
    return new Response("no", { status: 500 });
  };
  const result = await retryLogo({
    apiUrl: "http://api.test",
    poolId: pool,
    address: creator,
    bytes: new Uint8Array([1]),
    sign: async () => "0xsig",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(attached, 0);
});

test("launch does not claim an older coin or another creator's pool", async () => {
  const claimed: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/logos/claim")) {
      claimed.push((JSON.parse(String(init?.body)) as { poolId: string }).poolId);
      return new Response("no", { status: 404 });
    }
    return Response.json({
      coins: [
        { poolId: oldPool, feeRecipient: creator, launchTime: 1_700_000_040, image: null },
        { poolId: pool, feeRecipient: stranger, launchTime: 1_700_000_000, image: null },
      ],
    });
  };
  const bound = await bindLaunchLogo({
    apiUrl: "http://api.test",
    poolId: pool,
    feeRecipient: creator,
    fetchImpl,
    delaysMs: [0],
  });
  assert.equal(bound, false);
  assert.deepEqual(claimed, [pool, pool]);
});

test("launch claims the fresh coin and stops once the list has its image", async () => {
  const claimed: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/logos/claim")) {
      claimed.push((JSON.parse(String(init?.body)) as { poolId: string }).poolId);
      return new Response("no", { status: 404 });
    }
    return Response.json({
      coins: [{ poolId: pool, feeRecipient: creator, launchTime: 1_700_000_000, image: "/api/logos/abc.png" }],
    });
  };
  const bound = await bindLaunchLogo({
    apiUrl: "http://api.test",
    poolId: pool,
    feeRecipient: creator,
    fetchImpl,
    delaysMs: [0],
  });
  assert.equal(bound, true);
  assert.deepEqual(claimed, [pool]);
});
