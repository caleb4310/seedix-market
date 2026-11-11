import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export type Holder = { account: Address; balance: bigint };
export type Claim = { account: Address; amount: bigint };

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

/** Double hash of abi.encode(chainId, distributor, coin, pair, epoch, account, amount). */
export function leaf(parts: {
  chainId: bigint;
  distributor: Address;
  coin: Address;
  pair: Address;
  epoch: bigint;
  account: Address;
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

function hashPair(a: Hex, b: Hex): Hex {
  const left = a.toLowerCase() < b.toLowerCase() ? a : b;
  const right = left === a ? b : a;
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [left, right]));
}

export function buildTree(leaves: readonly Hex[]): { root: Hex; proofs: Hex[][] } {
  if (leaves.length === 0) throw new Error("empty round");
  const proofs: Hex[][] = leaves.map(() => []);
  let level: { hash: Hex; indexes: number[] }[] = leaves.map((item, index) => ({
    hash: item.toLowerCase() as Hex,
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
  if (!root) throw new Error("empty round");
  return { root, proofs };
}

export function verifyProof(root: Hex, leafHash: Hex, proof: readonly Hex[]): boolean {
  let hash = leafHash.toLowerCase() as Hex;
  for (const step of proof) hash = hashPair(hash, step);
  return hash === root.toLowerCase();
}

/** Pro-rata by balance. Dust and excluded accounts are left unallocated so they roll forward. */
export function allocate(input: {
  holders: readonly Holder[];
  pot: bigint;
  dust: bigint;
  excluded: readonly string[];
}): Claim[] {
  const skip = new Set(input.excluded.map((item) => item.toLowerCase()));
  skip.add(ZERO);
  skip.add(DEAD);
  const eligible = input.holders.filter((holder) => holder.balance > 0n && !skip.has(holder.account.toLowerCase()));
  const supply = eligible.reduce((sum, holder) => sum + holder.balance, 0n);
  if (supply === 0n || input.pot <= 0n) return [];
  const claims: Claim[] = [];
  for (const holder of eligible) {
    const amount = (input.pot * holder.balance) / supply;
    if (amount < input.dust) continue;
    claims.push({ account: holder.account, amount });
  }
  claims.sort((a, b) => (a.account.toLowerCase() < b.account.toLowerCase() ? -1 : 1));
  return claims;
}

export type Round = {
  chainId: bigint;
  distributor: Address;
  coin: Address;
  pair: Address;
  epoch: bigint;
  claims: Claim[];
  root: Hex;
  proofs: Hex[][];
};

/** Snapshot in, merkle root and claim proofs out. Does not broadcast fund or postRoot. */
export function buildRound(input: {
  chainId: bigint;
  distributor: Address;
  coin: Address;
  pair: Address;
  epoch: bigint;
  holders: readonly Holder[];
  pot: bigint;
  dust: bigint;
  excluded?: readonly string[];
}): Round | null {
  const claims = allocate({
    holders: input.holders,
    pot: input.pot,
    dust: input.dust,
    excluded: input.excluded ?? [],
  });
  if (claims.length === 0) return null;
  const leaves = claims.map((claim) =>
    leaf({
      chainId: input.chainId,
      distributor: input.distributor,
      coin: input.coin,
      pair: input.pair,
      epoch: input.epoch,
      account: claim.account,
      amount: claim.amount,
    }),
  );
  const tree = buildTree(leaves);
  return { ...input, claims, root: tree.root, proofs: tree.proofs, excluded: undefined } as Round;
}
