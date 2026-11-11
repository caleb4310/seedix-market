import { keccak256, type Hex } from "viem";
import { elysiumTestnet, logoAttachTypes, logoDomainName, logoUploadTypes } from "@seedix/shared";
import { apiUrl } from "./api";

const domain = { ...logoDomainName, chainId: elysiumTestnet.id };

export async function fetchLogoNonce(address: string): Promise<bigint> {
  const response = await fetch(`${apiUrl}/logos/nonce?address=${address}`);
  if (!response.ok) throw new Error("The logo service did not issue a nonce.");
  const body = (await response.json()) as { nonce?: string };
  return BigInt(body.nonce ?? "0");
}

export function logoExpiry(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
}

export function uploadTyped(bytes: Uint8Array, nonce: bigint, expiry: bigint) {
  return {
    domain,
    types: logoUploadTypes,
    primaryType: "LogoUpload" as const,
    message: { contentHash: keccak256(bytes), nonce, expiry },
  };
}

export function attachTyped(poolId: Hex, url: string, nonce: bigint, expiry: bigint) {
  return {
    domain,
    types: logoAttachTypes,
    primaryType: "LogoAttach" as const,
    message: { poolId, url, nonce, expiry },
  };
}
