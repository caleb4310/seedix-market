import { keccak256, recoverTypedDataAddress, type Address, type Hex } from "viem";
import {
  LOGO_EXPIRY_SECONDS,
  LOGO_RATE_LIMIT,
  LOGO_RATE_WINDOW_MS,
  activeChain,
  logoAttachTypes,
  logoDomainName,
  logoUploadTypes,
} from "@seedix/shared";

const nonces = new Map<string, bigint>();
const hits = new Map<string, number[]>();

export function peekNonce(address: string): bigint {
  return nonces.get(address.toLowerCase()) ?? 0n;
}

export function expiryOk(expiry: bigint, nowSec: bigint): boolean {
  return expiry > nowSec && expiry <= nowSec + BigInt(LOGO_EXPIRY_SECONDS);
}

export function consumeNonce(address: string, nonce: bigint): boolean {
  const key = address.toLowerCase();
  const expected = nonces.get(key) ?? 0n;
  if (nonce !== expected) return false;
  nonces.set(key, expected + 1n);
  return true;
}

/** Successful uploads and attaches count. A failed signature does not. */
export function withinRateLimit(address: string, nowMs = Date.now()): boolean {
  const key = address.toLowerCase();
  const recent = (hits.get(key) ?? []).filter((at) => nowMs - at < LOGO_RATE_WINDOW_MS);
  if (recent.length >= LOGO_RATE_LIMIT) {
    hits.set(key, recent);
    return false;
  }
  recent.push(nowMs);
  hits.set(key, recent);
  return true;
}

function domain(chainId: number) {
  return { ...logoDomainName, chainId };
}

export async function verifyUpload(input: {
  bytes: Uint8Array;
  nonce: bigint;
  expiry: bigint;
  signature: Hex;
  nowSec?: bigint;
}): Promise<{ ok: true; signer: Address } | { ok: false; error: string }> {
  const now = input.nowSec ?? BigInt(Math.floor(Date.now() / 1000));
  if (!expiryOk(input.expiry, now)) return { ok: false, error: "expired" };
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain: domain(activeChain().id),
      types: logoUploadTypes,
      primaryType: "LogoUpload",
      message: { contentHash: keccak256(input.bytes), nonce: input.nonce, expiry: input.expiry },
      signature: input.signature,
    });
  } catch {
    return { ok: false, error: "bad signature" };
  }
  if (!consumeNonce(signer, input.nonce)) return { ok: false, error: "bad nonce" };
  if (!withinRateLimit(signer)) return { ok: false, error: "rate limited" };
  return { ok: true, signer };
}

export async function verifyAttach(input: {
  poolId: Hex;
  url: string;
  nonce: bigint;
  expiry: bigint;
  signature: Hex;
  creator: Address;
  nowSec?: bigint;
}): Promise<{ ok: true; signer: Address } | { ok: false; error: string }> {
  const now = input.nowSec ?? BigInt(Math.floor(Date.now() / 1000));
  if (!expiryOk(input.expiry, now)) return { ok: false, error: "expired" };
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain: domain(activeChain().id),
      types: logoAttachTypes,
      primaryType: "LogoAttach",
      message: { poolId: input.poolId, url: input.url, nonce: input.nonce, expiry: input.expiry },
      signature: input.signature,
    });
  } catch {
    return { ok: false, error: "bad signature" };
  }
  if (signer.toLowerCase() !== input.creator.toLowerCase()) return { ok: false, error: "not creator" };
  if (!consumeNonce(signer, input.nonce)) return { ok: false, error: "bad nonce" };
  if (!withinRateLimit(signer)) return { ok: false, error: "rate limited" };
  return { ok: true, signer };
}
