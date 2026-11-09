import { encodeAbiParameters, keccak256, type Hex } from "viem";

export type ClaimLeaf = { account: Hex; amount: bigint };

export function hashPair(a: Hex, b: Hex): Hex {
  const left = a.toLowerCase() < b.toLowerCase() ? a : b;
  const right = left === a ? b : a;
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [left, right]));
}

/** Double hash of abi.encode(chainId, distributor, coin, pair, epoch, account, amount). */
export function kickbackLeaf(parts: {
  chainId: bigint;
  distributor: Hex;
  coin: Hex;
  pair: Hex;
  epoch: bigint;
  account: Hex;
  amount: bigint;
}): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint64" },
        { type: "address" },
        { type: "uint256" },
      ],
      [parts.chainId, parts.distributor, parts.coin, parts.pair, parts.epoch, parts.account, parts.amount],
    ),
  );
  return keccak256(inner);
}

export function buildTree(leaves: readonly Hex[]): { root: Hex; proofs: Hex[][] } {
  if (leaves.length === 0) throw new Error("empty manifest");
  const proofs: Hex[][] = leaves.map(() => []);
  let level: { hash: Hex; indexes: number[] }[] = leaves.map((leaf, index) => ({
    hash: leaf.toLowerCase() as Hex,
    indexes: [index],
  }));
  while (level.length > 1) {
    const next: { hash: Hex; indexes: number[] }[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      if (!left) continue;
      if (!right) {
        next.push(left);
        continue;
      }
      for (const index of left.indexes) proofs[index]?.push(right.hash);
      for (const index of right.indexes) proofs[index]?.push(left.hash);
      next.push({ hash: hashPair(left.hash, right.hash), indexes: [...left.indexes, ...right.indexes] });
    }
    level = next;
  }
  const root = level[0]?.hash;
  if (!root) throw new Error("empty manifest");
  return { root, proofs };
}
