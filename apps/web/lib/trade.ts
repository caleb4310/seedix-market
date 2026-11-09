import { elysiumTestnet } from "./chain";

export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;
export const DEADLINE_SECONDS = 20 * 60;

export const routerAddress = (process.env.NEXT_PUBLIC_ROUTER ?? "") as `0x${string}` | "";

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const routerAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "zeroForOne", type: "bool" },
      { name: "amountSpecified", type: "int256" },
      { name: "limitAmount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
] as const;

export function priceLimit(zeroForOne: boolean): bigint {
  return zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n;
}

export function explorerTx(hash: string): string {
  return `${elysiumTestnet.blockExplorers.default.url}/tx/${hash}`;
}

export function explainTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/user rejected|user denied|rejected the request/i.test(msg)) return "You rejected the request in your wallet. Nothing was sent.";
  if (msg.includes("Expired")) return "The deadline passed before the transaction was mined.";
  if (msg.includes("TooLittleReceived")) return "The pool moved past your minimum. Raise slippage or try a smaller size.";
  if (msg.includes("TooMuchRequested")) return "The trade would cost more than your maximum. Lower the size or raise slippage.";
  if (msg.includes("PriceLimit")) return "The price limit was rejected by the router.";
  if (/insufficient funds|exceeds balance/i.test(msg)) return "The wallet does not have enough of this token.";
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg;
}
