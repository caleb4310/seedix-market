import type { Address } from "./deployment";
import type { Mode } from "./coin";

export const MODE_VALUE: Record<Mode, number> = { keep: 0, kickback: 1, burn: 2 };

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export type LaunchParams = {
  name: string;
  symbol: string;
  pair: Address;
  mode: number;
  feeRecipient: Address;
  teamWallet: Address;
  teamBps: number;
  startMcapInPair: bigint;
};

export function buildLaunchParams(input: {
  name: string;
  symbol: string;
  pair: Address;
  mode: Mode;
  feeRecipient: Address;
  teamPercent: number;
  connected: Address;
  startMcapInPair: bigint;
}): LaunchParams {
  const name = input.name.trim();
  const symbol = input.symbol.trim();
  if (name.length === 0 || new TextEncoder().encode(name).length > 32) throw new Error("Name must be 1 to 32 bytes.");
  if (symbol.length === 0 || new TextEncoder().encode(symbol).length > 8) throw new Error("Ticker must be 1 to 8 bytes.");
  if (!Number.isInteger(input.teamPercent) || input.teamPercent < 0 || input.teamPercent > 5) {
    throw new Error("Team supply must be a whole percent from 0 to 5.");
  }
  if (input.startMcapInPair <= 0n) throw new Error("Starting market cap must be greater than zero.");
  const teamBps = input.teamPercent * 100;
  return {
    name,
    symbol,
    pair: input.pair,
    mode: MODE_VALUE[input.mode],
    feeRecipient: input.feeRecipient,
    teamWallet: teamBps === 0 ? ZERO : input.connected,
    teamBps,
    startMcapInPair: input.startMcapInPair,
  };
}
