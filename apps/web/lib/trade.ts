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

export const quoterAddress = (process.env.NEXT_PUBLIC_QUOTER ?? "") as `0x${string}` | "";
export const stateViewAddress = (process.env.NEXT_PUBLIC_STATE_VIEW ?? "") as `0x${string}` | "";

export const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
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
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

export const tokenMetaAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const launcherAbi = [
  {
    type: "event",
    name: "CoinLaunched",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "coin", type: "address", indexed: true },
      { name: "pair", type: "address", indexed: true },
      { name: "mode", type: "uint8", indexed: false },
      { name: "isPlatform", type: "bool", indexed: false },
      { name: "feeRecipient", type: "address", indexed: false },
      { name: "teamWallet", type: "address", indexed: false },
      { name: "teamAmount", type: "uint256", indexed: false },
      { name: "startMcap", type: "uint256", indexed: false },
    ],
  },
] as const;

export const hookConfigAbi = [
  {
    type: "function",
    name: "config",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "coin", type: "address" },
      { name: "pair", type: "address" },
      { name: "coinIsToken0", type: "bool" },
      { name: "mode", type: "uint8" },
      { name: "isPlatform", type: "bool" },
      { name: "launchTime", type: "uint40" },
      { name: "feeRecipient", type: "address" },
    ],
  },
] as const;

export const decimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const launcherAddress = (process.env.NEXT_PUBLIC_LAUNCHER ?? "") as `0x${string}` | "";
export const hookAddress = (process.env.NEXT_PUBLIC_HOOK ?? "") as `0x${string}` | "";

const defaultExplorerTemplate = `${elysiumTestnet.blockExplorers.default.url}/tx/{hash}`;

/** `{hash}` is replaced with the transaction hash. Verify the path on the first testnet transaction. */
export function explorerTx(hash: string): string {
  const template = process.env.NEXT_PUBLIC_EXPLORER_TX_URL_TEMPLATE || defaultExplorerTemplate;
  return template.replaceAll("{hash}", hash);
}

export function explainTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/user rejected|user denied|rejected the request/i.test(msg)) return "You rejected the request in your wallet. Nothing was sent.";
  if (/HttpRequestError|TimeoutError|RpcRequestError|failed to fetch|network request failed/i.test(msg)) {
    return "The network request failed. Check the RPC and try again.";
  }
  if (msg.includes("Expired")) return "The deadline passed before the transaction was mined.";
  if (msg.includes("TooLittleReceived")) return "This trade would receive less than the quoted minimum. Raise slippage or try a smaller amount.";
  if (msg.includes("TooMuchRequested")) return "This trade would cost more than the quoted maximum. Lower the size or raise slippage.";
  if (msg.includes("PriceLimit")) return "The price limit stopped the trade before it filled. Try a smaller amount.";
  if (/insufficient funds|exceeds balance/i.test(msg)) return "The wallet does not have enough of this token.";
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg;
}
