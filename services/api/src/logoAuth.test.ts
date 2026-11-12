import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { elysiumTestnet, logoAttachTypes, logoDomainName, logoUploadTypes } from "@seedix/shared";
import { verifyAttach, verifyUpload } from "./logoAuth.ts";

test("a wallet signature authorizes one upload and the nonce cannot be reused", async () => {
  const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
  const sign = (nonce: bigint) =>
    account.signTypedData({
      domain: { ...logoDomainName, chainId: elysiumTestnet.id },
      types: logoUploadTypes,
      primaryType: "LogoUpload",
      message: { contentHash: keccak256(bytes), nonce, expiry },
    });
  const first = await verifyUpload({ bytes, nonce: 0n, expiry, signature: await sign(0n) });
  assert.equal(first.ok, true);
  const replay = await verifyUpload({ bytes, nonce: 0n, expiry, signature: await sign(0n) });
  assert.equal(replay.ok, false);
  const next = await verifyUpload({ bytes, nonce: 1n, expiry, signature: await sign(1n) });
  assert.equal(next.ok, true);
  if (next.ok) assert.equal(next.signer.toLowerCase(), account.address.toLowerCase());
});

test("a wallet that is not the creator cannot attach a logo to the pool", async () => {
  const creator = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
  const stranger = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const poolId = `0x${"ab".repeat(32)}` as const;
  const url = "/api/logos/abc.png";
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
  const signature = await stranger.signTypedData({
    domain: { ...logoDomainName, chainId: elysiumTestnet.id },
    types: logoAttachTypes,
    primaryType: "LogoAttach",
    message: { poolId, url, nonce: 0n, expiry },
  });
  const result = await verifyAttach({
    poolId,
    url,
    nonce: 0n,
    expiry,
    signature,
    creator: creator.address,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "not creator");
  const own = await verifyAttach({
    poolId,
    url,
    nonce: 0n,
    expiry,
    signature: await creator.signTypedData({
      domain: { ...logoDomainName, chainId: elysiumTestnet.id },
      types: logoAttachTypes,
      primaryType: "LogoAttach",
      message: { poolId, url, nonce: 0n, expiry },
    }),
    creator: creator.address,
  });
  assert.equal(own.ok, true);
});
