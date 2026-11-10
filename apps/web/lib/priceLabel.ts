/**
 * USD is the primary figure when the CoinGecko quote exists.
 * The HYPE amount stays as the secondary suffix. With no quote, the figure is HYPE and there is no dollar sign.
 */
export function priceLabel(symbol: string, usd?: number | null): { dollar: boolean; suffix: string } {
  const name = symbol.trim();
  if (usd != null && Number.isFinite(usd) && usd > 0) {
    return { dollar: true, suffix: name ? ` · ${name}` : "" };
  }
  return { dollar: false, suffix: name ? ` ${name}` : "" };
}
