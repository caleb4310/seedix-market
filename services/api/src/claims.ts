import { readdir, readFile } from "node:fs/promises";
import { activeChain } from "@seedix/shared";
import path from "node:path";
import type { Hex } from "viem";
import { buildTree, kickbackLeaf } from "./merkle.ts";

export type Manifest = {
  poolId: Hex;
  epoch: bigint;
  chainId: bigint;
  distributor: Hex;
  coin: Hex;
  pair: Hex;
  claims: { account: Hex; amount: bigint }[];
};

export type ClaimProof = { epoch: string; amount: string; proof: Hex[] };

export function parseManifest(text: string): Manifest | null {
  try {
    const raw = JSON.parse(text) as {
      poolId?: string;
      epoch?: string;
      chainId?: number;
      distributor?: string;
      coin?: string;
      pair?: string;
      claims?: { account?: string; amount?: string }[];
    };
    if (!raw.poolId?.startsWith("0x") || !raw.epoch || !raw.distributor || !raw.coin || !raw.pair || !raw.claims?.length) return null;
    return {
      poolId: raw.poolId as Hex,
      epoch: BigInt(raw.epoch),
      chainId: BigInt(raw.chainId ?? activeChain().id),
      distributor: raw.distributor as Hex,
      coin: raw.coin as Hex,
      pair: raw.pair as Hex,
      claims: raw.claims.map((claim) => ({ account: claim.account as Hex, amount: BigInt(claim.amount ?? "0") })),
    };
  } catch {
    return null;
  }
}

export function proofsForAccount(manifests: readonly Manifest[], poolId: string, account: string): ClaimProof[] {
  const out: ClaimProof[] = [];
  for (const manifest of manifests) {
    if (manifest.poolId.toLowerCase() !== poolId.toLowerCase()) continue;
    const leaves = manifest.claims.map((claim) =>
      kickbackLeaf({
        chainId: manifest.chainId,
        distributor: manifest.distributor,
        coin: manifest.coin,
        pair: manifest.pair,
        epoch: manifest.epoch,
        account: claim.account,
        amount: claim.amount,
      }),
    );
    const tree = buildTree(leaves);
    manifest.claims.forEach((claim, index) => {
      if (claim.account.toLowerCase() !== account.toLowerCase()) return;
      const proof = tree.proofs[index] ?? [];
      out.push({ epoch: manifest.epoch.toString(), amount: claim.amount.toString(), proof });
    });
  }
  return out;
}

export async function claimsForPool(poolId: string, account: string, dir = process.env.KICKBACK_MANIFEST_DIR ?? ""): Promise<ClaimProof[]> {
  if (!dir) return [];
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const manifests: Manifest[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const parsed = parseManifest(await readFile(path.join(dir, name), "utf8"));
    if (parsed) manifests.push(parsed);
  }
  return proofsForAccount(manifests, poolId, account);
}
