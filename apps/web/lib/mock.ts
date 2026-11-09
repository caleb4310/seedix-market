export type Mode = "keep" | "kickback" | "burn";

export type Coin = {
  id: string;
  name: string;
  ticker: string;
  pair: "WHYPE" | "wNVDAx" | "wSPYx" | "USDC";
  mode: Mode;
  mcap: number;
  price: number;
  ageSec: number;
  creator: string;
  holders: number;
  description: string;
  recipient: `0x${string}`;
  coinIsToken0?: boolean;
  tokenAddress?: `0x${string}`;
  pairAddress?: `0x${string}`;
  hooks?: `0x${string}`;
  poolId?: `0x${string}`;
};


export const coins: Coin[] = [
  {
    id: "kiln",
    name: "Kiln",
    ticker: "KILN",
    pair: "WHYPE",
    mode: "burn",
    mcap: 28400,
    price: 0.0000284,
    ageSec: 2,
    creator: "0x4c1a…9e20",
    holders: 18,
    description: "A burn-mode coin paired with WHYPE.",
    recipient: "0x4c1a000000000000000000000000000000009e20",
  },
  {
    id: "harbor",
    name: "Harbor",
    ticker: "HARB",
    pair: "wNVDAx",
    mode: "keep",
    mcap: 186200,
    price: 0.000186,
    ageSec: 1_728_000,
    creator: "0x91b0…44ac",
    holders: 640,
    description: "Fees stay with the creator. Paired with wrapped NVIDIA.",
    recipient: "0x91b00000000000000000000000000000000044ac",
  },
  {
    id: "northline",
    name: "Northline",
    ticker: "NLIN",
    pair: "wSPYx",
    mode: "kickback",
    mcap: 94200,
    price: 0.000094,
    ageSec: 86_400,
    creator: "0x22de…10b4",
    holders: 311,
    description: "Pair-side fees are paid back to holders each hour.",
    recipient: "0x22de0000000000000000000000000000000010b4",
  },
  {
    id: "orchard",
    name: "Orchard",
    ticker: "ORCH",
    pair: "WHYPE",
    mode: "kickback",
    mcap: 41200,
    price: 0.000041,
    ageSec: 14_400,
    creator: "0x77a1…c0de",
    holders: 128,
    description: "Kickback coin. Holders split the pair token.",
    recipient: "0x77a100000000000000000000000000000000c0de",
  },
  {
    id: "switchyard",
    name: "Switchyard",
    ticker: "YARD",
    pair: "USDC",
    mode: "keep",
    mcap: 67300,
    price: 0.000067,
    ageSec: 3_600,
    creator: "0x0aa4…8811",
    holders: 204,
    description: "USDC pair. Creator claims both sides.",
    recipient: "0x0aa4000000000000000000000000000000008811",
  },
  {
    id: "marrow",
    name: "Marrow",
    ticker: "MARW",
    pair: "wNVDAx",
    mode: "burn",
    mcap: 121000,
    price: 0.000121,
    ageSec: 250_000,
    creator: "0xbe01…7712",
    holders: 455,
    description: "Hook fees buy the coin and burn it.",
    recipient: "0xbe01000000000000000000000000000000007712",
  },
  {
    id: "lowtide",
    name: "Low tide",
    ticker: "TIDE",
    pair: "WHYPE",
    mode: "keep",
    mcap: 20800,
    price: 0.0000208,
    ageSec: 900,
    creator: "0x33f0…ab90",
    holders: 42,
    description: "Just past the decay. Starting cap was the 20,000 reset.",
    recipient: "0x33f000000000000000000000000000000000ab90",
  },
  {
    id: "paperweight",
    name: "Paperweight",
    ticker: "PWGT",
    pair: "wSPYx",
    mode: "burn",
    mcap: 54000,
    price: 0.000054,
    ageSec: 50_000,
    creator: "0x18cc…0901",
    holders: 176,
    description: "Burn mode against the S&P wrapper.",
    recipient: "0x18cc000000000000000000000000000000000901",
  },
];

export function getCoin(id: string): Coin | undefined {
  return coins.find((c) => c.id === id);
}

export function modeLabel(mode: Mode): string {
  if (mode === "keep") return "Keep";
  if (mode === "kickback") return "Kick back";
  return "Burn";
}
