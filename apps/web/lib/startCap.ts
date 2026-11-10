/** 34 WHYPE is about $2,500 when HYPE is $74.6. The timelock can change the on-chain default. */
export const DEFAULT_START_WHYPE = 34;
export const DEFAULT_START_WEI = 34n * 10n ** 18n;

export function startWhypeFromChain(value: bigint | undefined): bigint {
  if (value !== undefined && value > 0n) return value;
  return DEFAULT_START_WEI;
}

export function whypeAmount(wei: bigint): number {
  return Number(wei / 10n ** 15n) / 1000;
}

export function formatUsdCompact(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "USD price unavailable";
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) {
    const millions = usd / 1_000_000;
    return `$${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (usd >= 1000) {
    const thousands = usd / 1000;
    return `$${thousands >= 100 ? thousands.toFixed(0) : thousands.toFixed(1)}K`;
  }
  if (usd >= 1) return `$${usd.toFixed(usd >= 100 ? 0 : 2)}`;
  return `$${usd.toFixed(4)}`;
}

/** Launch and preview caps are USD only. A missing quote is a label, not a token amount. */
export function launchCapLabel(hypeUsd: number | null, wei: bigint = DEFAULT_START_WEI): string {
  if (hypeUsd == null || !(hypeUsd > 0)) return "USD price unavailable";
  return `${formatUsdCompact(whypeAmount(wei) * hypeUsd)} MC`;
}
