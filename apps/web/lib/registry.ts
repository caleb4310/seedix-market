import { apiUrl } from "./api";

export type PairCategory = "crypto" | "stock" | "preipo";

export type ListedPair = {
  address: `0x${string}`;
  status: number;
  category: PairCategory;
  symbol: string;
  name: string;
  logo: string | null;
  usd: number | null;
  test: boolean;
};

type PairResponse = { address?: string; status?: number; category?: string };
type TokenResponse = {
  address?: string;
  symbol?: string;
  name?: string;
  logo?: string;
  category?: string;
  usd?: number;
  test?: boolean;
};

function categoryOf(value: string | undefined): PairCategory {
  if (value === "stock" || value === "preipo") return value;
  return "crypto";
}

/** A listed pair with no token-list symbol takes `symbol()` from the chain. */
export async function withChainSymbols(
  pairs: ListedPair[],
  readSymbol: (address: `0x${string}`) => Promise<string>,
): Promise<ListedPair[]> {
  return Promise.all(
    pairs.map(async (pair) => {
      if (pair.symbol.trim()) return pair;
      try {
        const symbol = (await readSymbol(pair.address)).trim();
        if (!symbol) return pair;
        return { ...pair, symbol, name: pair.name.trim() || symbol };
      } catch {
        return pair;
      }
    }),
  );
}

/** Tab text for a pair. A missing symbol still leaves a short address, never an empty label. */
export function pairTabLabel(pair: Pick<ListedPair, "symbol" | "address">): string {
  const symbol = pair.symbol.trim();
  if (symbol) return symbol;
  return `${pair.address.slice(0, 6)}…${pair.address.slice(-4)}`;
}

export async function loadPairs(): Promise<ListedPair[]> {
  const root = apiUrl || "";
  const [pairRes, listRes] = await Promise.all([
    fetch(`${root}/pairs`).then((res) => (res.ok ? res.json() : { pairs: [] })),
    fetch(`${root}/tokenlist`).then((res) => (res.ok ? res.json() : { tokens: [] })),
  ]);
  const overlay = new Map<string, TokenResponse>();
  for (const token of (listRes.tokens ?? []) as TokenResponse[]) {
    if (typeof token.address === "string") overlay.set(token.address.toLowerCase(), token);
  }
  return ((pairRes.pairs ?? []) as PairResponse[]).flatMap((pair) => {
    if (typeof pair.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(pair.address)) return [];
    const extra = overlay.get(pair.address.toLowerCase());
    return [
      {
        address: pair.address as `0x${string}`,
        status: Number(pair.status ?? 0),
        category: categoryOf(pair.category),
        symbol: extra?.symbol || "",
        name: extra?.name || extra?.symbol || "",
        logo: extra?.logo ?? null,
        usd: typeof extra?.usd === "number" ? extra.usd : null,
        test: extra?.test === true,
      },
    ];
  });
}
