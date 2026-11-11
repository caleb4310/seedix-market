/**
 * USD is the primary figure when the CoinGecko quote exists.
 * The HYPE amount stays as the secondary suffix. With no quote, the figure is HYPE and there is no dollar sign.
 */
export type SpotFigure = { kind: "plain"; text: string } | { kind: "sub"; zeros: number; text: string };

/** Never scientific notation. Two or more leading zeros become a subscript. */
export function spotFigure(value: number): SpotFigure {
  if (!Number.isFinite(value) || value <= 0) return { kind: "plain", text: "0" };
  if (value >= 1) return { kind: "plain", text: value.toLocaleString("en-US", { maximumFractionDigits: 4 }) };
  const raw = value.toFixed(18);
  const match = raw.match(/^0\.(0*)([1-9]\d*)/);
  if (!match) return { kind: "plain", text: "0" };
  const zeros = match[1]?.length ?? 0;
  const digits = (match[2] ?? "").replace(/0+$/, "").slice(0, 4);
  if (zeros >= 2) return { kind: "sub", zeros, text: digits };
  const places = Math.min(8, zeros + digits.length);
  return { kind: "plain", text: value.toFixed(places).replace(/\.?0+$/, "") };
}

export function priceLabel(symbol: string, usd?: number | null): { dollar: boolean; suffix: string } {
  const name = symbol.trim();
  if (usd != null && Number.isFinite(usd) && usd > 0) {
    return { dollar: true, suffix: name ? ` · ${name}` : "" };
  }
  return { dollar: false, suffix: name ? ` ${name}` : "" };
}
