process.env.CHAIN_ID ??= "99801";

import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { elysiumTestnet, logoDomainName, logoUploadTypes } from "@seedix/shared";
import { verifyUpload } from "./logoAuth.ts";

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
