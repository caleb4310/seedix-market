/** A dollar prefix only when the pair has a real USD quote. Otherwise the pair symbol. */
export function priceLabel(symbol: string, usd?: number | null): { dollar: boolean; suffix: string } {
  if (usd != null && Number.isFinite(usd) && usd > 0) return { dollar: true, suffix: "" };
  const name = symbol.trim();
  return { dollar: false, suffix: name ? ` ${name}` : "" };
}
