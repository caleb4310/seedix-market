import type { Mode } from "./coin";

const WHYPE = /^whype$/i;

export function backingLabel(input: {
  mode: Mode;
  pair?: string | null;
  backingSymbol?: string | null;
}): string {
  if (input.mode === "burn") return "Burn";
  const named = (input.backingSymbol ?? "").trim();
  if (named && !WHYPE.test(named)) return named;
  const pair = (input.pair ?? "").trim();
  if (pair && !WHYPE.test(pair)) return pair;
  return "Backing";
}

export function isWhypeLabel(value: string | null | undefined): boolean {
  return WHYPE.test((value ?? "").trim());
}
