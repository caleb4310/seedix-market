import type { Hex } from "viem";
import { apiUrl as configuredApi } from "./api";
import { attachTyped, logoExpiry, uploadTyped } from "./logoSign";
import { logoAttachPath, logoSrc } from "./logoUrl";

type UploadTyped = ReturnType<typeof uploadTyped>;
type AttachTyped = ReturnType<typeof attachTyped>;
export type LogoSign = (typed: UploadTyped | AttachTyped) => Promise<string>;

type ListedCoin = {
  poolId?: string;
  feeRecipient?: string;
  image?: string | null;
};

/** The connected wallet can add a logo only for a pool it created, and only while the coin has none. */
export function canAddLogo(input: {
  connected?: string | null;
  creator?: string | null;
  recipient?: string | null;
  image?: string | null;
}): boolean {
  if (input.image) return false;
  const wallet = input.connected?.toLowerCase();
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) return false;
  const owners = [input.creator, input.recipient]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());
  return owners.includes(wallet);
}

function bytesBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function readNonce(apiUrl: string, address: string, fetchImpl: typeof fetch): Promise<bigint> {
  const response = await fetchImpl(`${apiUrl}/logos/nonce?address=${address}`);
  if (!response.ok) throw new Error("The logo service did not issue a nonce.");
  const body = (await response.json()) as { nonce?: string };
  return BigInt(body.nonce ?? "0");
}

/**
 * Token-page retry. The creator signs the upload and then the attach, so the logo cannot land on another pool.
 */
export async function retryLogo(input: {
  apiUrl?: string;
  poolId: Hex;
  address: string;
  bytes: Uint8Array;
  sign: LogoSign;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const apiUrl = input.apiUrl ?? configuredApi;
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!apiUrl) return { ok: false, error: "The logo service is unavailable." };
  try {
    const nonce = await readNonce(apiUrl, input.address, fetchImpl);
    const expiry = logoExpiry();
    const uploadSignature = await input.sign(uploadTyped(input.bytes, nonce, expiry));
    const uploaded = await fetchImpl(`${apiUrl}/logos`, {
      method: "POST",
      body: bytesBody(input.bytes),
      headers: {
        "x-seedix-nonce": nonce.toString(),
        "x-seedix-expiry": expiry.toString(),
        "x-seedix-signature": uploadSignature,
      },
    });
    if (!uploaded.ok) return { ok: false, error: "Use a PNG, JPEG, or WEBP under 1MB, and sign with your wallet." };
    const saved = (await uploaded.json()) as { url?: string };
    const path = saved.url ? logoAttachPath(saved.url, apiUrl) : null;
    const shown = logoSrc(saved.url);
    if (!path || !shown) return { ok: false, error: "The logo could not be stored." };
    const attachNonce = await readNonce(apiUrl, input.address, fetchImpl);
    const attachExpiry = logoExpiry();
    const attachSignature = await input.sign(attachTyped(input.poolId, path, attachNonce, attachExpiry));
    const attached = await fetchImpl(`${apiUrl}/logos/attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        poolId: input.poolId,
        url: path,
        nonce: attachNonce.toString(),
        expiry: attachExpiry.toString(),
        signature: attachSignature,
      }),
    });
    if (!attached.ok) return { ok: false, error: "The logo was not attached." };
    return { ok: true, url: shown };
  } catch {
    return { ok: false, error: "The logo signature was rejected." };
  }
}

async function claimPool(apiUrl: string, poolId: string, fetchImpl: typeof fetch): Promise<boolean> {
  const response = await fetchImpl(`${apiUrl}/logos/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ poolId }),
  });
  return response.ok;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Bind the logo uploaded before launch. The receipt pool is claimed with no second signature.
 * Polling the creator's coins picks up the server bind once the indexer has that same pool.
 */
export async function bindLaunchLogo(input: {
  apiUrl: string;
  poolId: string;
  feeRecipient: string;
  fetchImpl?: typeof fetch;
  delaysMs?: number[];
}): Promise<boolean> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (await claimPool(input.apiUrl, input.poolId, fetchImpl).catch(() => false)) return true;
  const owner = input.feeRecipient.toLowerCase();
  for (const delay of input.delaysMs ?? [1_500, 3_000, 6_000, 10_000]) {
    if (delay > 0) await sleep(delay);
    let coins: ListedCoin[] = [];
    try {
      const listed = await fetchImpl(`${input.apiUrl}/coins?feeRecipient=${encodeURIComponent(input.feeRecipient)}`);
      if (!listed.ok) continue;
      const body = (await listed.json()) as { coins?: ListedCoin[] };
      coins = body.coins ?? [];
    } catch {
      continue;
    }
    const exact = coins.find(
      (coin) => coin.feeRecipient?.toLowerCase() === owner && coin.poolId?.toLowerCase() === input.poolId.toLowerCase(),
    );
    if (exact?.image) return true;
    if (await claimPool(input.apiUrl, input.poolId, fetchImpl).catch(() => false)) return true;
  }
  return false;
}
