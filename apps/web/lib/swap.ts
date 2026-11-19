import { extremeSqrtPriceLimit, maximumFromQuote, minimumFromQuote } from "./amounts";
import { erc20Abi, swapAbi, wethAbi } from "./abi";
import { nativeSymbol } from "./chain";
import { type Address, routerAddress, sameAddress, whypeAddress } from "./deployment";
import { LP_FEE, TICK_SPACING, UINT128_MAX } from "./protocol";
import { exactApproval, type TxStep } from "./tx";

export type SwapKind = "exactIn" | "exactOut";
export type Side = "buy" | "sell";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export function poolKey(coin: Address, pair: Address, hooks: Address): { key: PoolKey; coinIsToken0: boolean } {
  const coinIsToken0 = BigInt(coin) < BigInt(pair);
  return {
    coinIsToken0,
    key: {
      currency0: coinIsToken0 ? coin : pair,
      currency1: coinIsToken0 ? pair : coin,
      fee: LP_FEE,
      tickSpacing: TICK_SPACING,
      hooks,
    },
  };
}

export function zeroForOne(side: Side, coinIsToken0: boolean): boolean {
  return side === "buy" ? !coinIsToken0 : coinIsToken0;
}

/** Exact-in passes minOut. Exact-out passes maxIn. SeedixRouter takes that single limit. */
export function swapLimit(kind: SwapKind, quoted: bigint, slippagePct: number): bigint {
  return kind === "exactIn" ? minimumFromQuote(quoted, slippagePct) : maximumFromQuote(quoted, slippagePct);
}

export function amountSpecifiedFor(kind: SwapKind, amount: bigint): bigint {
  if (amount <= 0n || amount > UINT128_MAX) throw new Error("Enter a token amount the quoter can price.");
  return kind === "exactIn" ? -amount : amount;
}

export function quotedAmount(result: unknown): bigint | undefined {
  if (typeof result === "bigint") return result;
  if (Array.isArray(result) && typeof result[0] === "bigint") return result[0];
  if (result && typeof result === "object") {
    const record = result as { amountOut?: unknown; amountIn?: unknown };
    if (typeof record.amountOut === "bigint") return record.amountOut;
    if (typeof record.amountIn === "bigint") return record.amountIn;
  }
  return undefined;
}

export function approvalForSwap(kind: SwapKind, typedAmount: bigint, quoted: bigint, slippagePct: number): bigint {
  const needed = kind === "exactIn" ? typedAmount : swapLimit(kind, quoted, slippagePct);
  return exactApproval(needed);
}

export function quoteParams(key: PoolKey, zeroForOneFlag: boolean, exactAmount: bigint) {
  if (exactAmount <= 0n || exactAmount > UINT128_MAX) throw new Error("Enter a token amount the quoter can price.");
  return { poolKey: key, zeroForOne: zeroForOneFlag, exactAmount, hookData: "0x" as const };
}

/** Wrap only the HYPE shortfall, then approve the exact spend, then swap. The router pulls ERC-20, not native HYPE. */
export function tradeSteps(input: {
  action: string;
  kind: SwapKind;
  spendToken: Address;
  spendLabel: string;
  key: PoolKey;
  zeroForOne: boolean;
  typedAmount: bigint;
  quoted: bigint;
  slippagePct: number;
  deadline: bigint;
  allowance: bigint;
  tokenBalance: bigint;
  nativeBalance: bigint;
}): { steps: TxStep[] } | { error: string } {
  const needed = approvalForSwap(input.kind, input.typedAmount, input.quoted, input.slippagePct);
  const steps: TxStep[] = [];
  let balance = input.tokenBalance;
  if (sameAddress(input.spendToken, whypeAddress) && balance < needed) {
    const shortfall = needed - balance;
    if (input.nativeBalance < shortfall) return { error: `The wallet does not have enough ${nativeSymbol} to wrap.` };
    steps.push({
      action: `Wrap ${nativeSymbol}`,
      address: whypeAddress,
      abi: wethAbi,
      functionName: "deposit",
      args: [],
      value: shortfall,
    });
    balance += shortfall;
  }
  if (balance < needed) return { error: "The wallet does not have enough of this token." };
  if (input.allowance < needed) {
    steps.push({
      action: `Approve ${input.spendLabel}`,
      address: input.spendToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [routerAddress, needed],
      value: undefined,
    });
  }
  steps.push({
    action: input.action,
    address: routerAddress,
      abi: swapAbi,
    functionName: "swap",
    args: [
      input.key,
      input.zeroForOne,
      amountSpecifiedFor(input.kind, input.typedAmount),
      swapLimit(input.kind, input.quoted, input.slippagePct),
      input.deadline,
      extremeSqrtPriceLimit(input.zeroForOne),
    ],
  });
  return { steps };
}
