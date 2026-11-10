import type { Mode } from "./coin";

const WHYPE = /^whype$/i;

export function backingLabel(input: {
  mode: Mode;
  pair?: string | null;
  backing?: string | null;
  backingSymbol?: string | null;
}): string {
  if (input.mode === "burn") return "Burn";
  const named = (input.backingSymbol ?? "").trim();
  if (named && !WHYPE.test(named)) return named;
  const pair = (input.pair ?? "").trim();
  if (pair && !WHYPE.test(pair)) return pair;
  const address = (input.backing ?? "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/i.test(address)) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }
  return "—";
}

export function isWhypeLabel(value: string | null | undefined): boolean {
  return WHYPE.test((value ?? "").trim());
}
