/** 0.001 gwei. A zero RPC tip must not leave the max fee equal to the base fee. */
export const PRIORITY_FLOOR_WEI = 1_000_000n;

export type Eip1559Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
export type LegacyFees = { gasPrice: bigint };
export type TxFees = Eip1559Fees | LegacyFees;

export function priorityFloorWei(raw: string | undefined, fallback = PRIORITY_FLOOR_WEI): bigint {
  const text = (raw ?? "").trim();
  if (!/^\d+$/.test(text)) return fallback;
  const value = BigInt(text);
  return value > 0n ? value : fallback;
}

/**
 * EIP-1559: tip is at least the floor, and the max fee is twice the base fee plus that tip.
 * Legacy chains get gasPrice × 1.25, and never below the same floor.
 */
export function transactionFees(input: {
  baseFeePerGas?: bigint | null;
  rpcTip?: bigint | null;
  priorityFloor?: bigint;
  legacyGasPrice?: bigint | null;
}): TxFees {
  const floor = input.priorityFloor ?? PRIORITY_FLOOR_WEI;
  const base = input.baseFeePerGas;
  if (base == null) {
    const price = input.legacyGasPrice ?? 0n;
    const bumped = price + price / 4n;
    return { gasPrice: bumped > floor ? bumped : floor };
  }
  const tip = input.rpcTip ?? 0n;
  const priority = tip > floor ? tip : floor;
  const doubled = base * 2n + priority;
  const aboveBase = base + priority;
  const maxFeePerGas = doubled > aboveBase ? doubled : aboveBase;
  return { maxFeePerGas, maxPriorityFeePerGas: priority };
}

/** Lower a quote to `cap` only when the cap still clears the base fee plus tip. */
export function capTransactionFees(fees: TxFees, cap: bigint, baseFeePerGas?: bigint | null): TxFees {
  if (cap <= 0n) return fees;
  if ("gasPrice" in fees) return { gasPrice: fees.gasPrice > cap ? cap : fees.gasPrice };
  if (fees.maxFeePerGas <= cap) return fees;
  const needed = (baseFeePerGas ?? 0n) + fees.maxPriorityFeePerGas;
  if (cap < needed) return fees;
  return { maxFeePerGas: cap, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}
