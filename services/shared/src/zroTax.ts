/** ZRO holder tax. ON_TOP is the default: traders pay the creator rate plus the 1% Seedix fee. */

export const ZRO_BPS = 10_000;
export const PROTOCOL_FEE_BPS = 100;
export const MAX_PROTOCOL_FEE_BPS = 100;
export const MAX_EFFECTIVE_TAX_BPS = 1_000;
export const MAX_CREATOR_TAX_BPS = MAX_EFFECTIVE_TAX_BPS - MAX_PROTOCOL_FEE_BPS;

export type ZroFeeMode = "on_top" | "from_creator_tax";

export type ZroTax = {
  enabled: boolean;
  creatorTaxBps: number;
  protocolFeeBps: number;
  feeMode: ZroFeeMode;
  effectiveTaxBps: number;
};

export function zroFeeMode(value: unknown): ZroFeeMode {
  if (value === "from_creator_tax" || value === 0 || value === "0") return "from_creator_tax";
  return "on_top";
}

/** Trader-facing rate. Off pools report 0, not a phantom 1%. */
export function reportedZroTax(input: {
  enabled?: boolean;
  creatorTaxBps?: number;
  protocolFeeBps?: number;
  feeMode?: unknown;
}): ZroTax {
  const feeMode = zroFeeMode(input.feeMode);
  const protocolFeeBps = clampInt(input.protocolFeeBps, 0, MAX_PROTOCOL_FEE_BPS, PROTOCOL_FEE_BPS);
  const creatorTaxBps = clampInt(input.creatorTaxBps, 0, MAX_CREATOR_TAX_BPS, 0);
  const enabled = Boolean(input.enabled);
  if (!enabled) {
    return { enabled: false, creatorTaxBps, protocolFeeBps, feeMode, effectiveTaxBps: 0 };
  }
  const effectiveTaxBps = feeMode === "on_top" ? creatorTaxBps + protocolFeeBps : creatorTaxBps;
  return {
    enabled: true,
    creatorTaxBps,
    protocolFeeBps,
    feeMode,
    effectiveTaxBps: Math.min(effectiveTaxBps, MAX_EFFECTIVE_TAX_BPS),
  };
}

export function formatTaxBps(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}

/** What the launch form and the coin page should say about the rate the trader pays. */
export function zroTaxLabel(tax: ZroTax): string {
  if (!tax.enabled || tax.effectiveTaxBps === 0) return "ZRO holder tax is off";
  if (tax.feeMode === "on_top") {
    return `ZRO tax ${formatTaxBps(tax.effectiveTaxBps)} (${formatTaxBps(tax.creatorTaxBps)} to holders + ${formatTaxBps(tax.protocolFeeBps)} Seedix)`;
  }
  return `ZRO tax ${formatTaxBps(tax.effectiveTaxBps)} (Seedix ${formatTaxBps(tax.protocolFeeBps)} is taken from the creator tax)`;
}

/** Creator percent typed in the launch form. Empty is 0. Above 9% does not fit under the 10% cap. */
export function creatorBpsFromPercent(raw: string): { ok: true; bps: number } | { ok: false; message: string } {
  const text = raw.trim();
  if (text === "") return { ok: true, bps: 0 };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, message: "Holder tax must be a percent with at most two decimals." };
  const pct = Number(text);
  if (!Number.isFinite(pct) || pct < 0) return { ok: false, message: "Holder tax cannot be negative." };
  const bps = Math.round(pct * 100);
  if (bps > MAX_CREATOR_TAX_BPS) {
    return { ok: false, message: "Holder tax plus the 1% Seedix fee cannot exceed 10%." };
  }
  return { ok: true, bps };
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const next = Math.trunc(value);
  if (next < min) return min;
  if (next > max) return max;
  return next;
}
