import { priceLabel } from "@/lib/priceLabel";

function tiny(value: number): { kind: "plain" | "sub"; text: string; zeros?: number } {
  if (!Number.isFinite(value) || value <= 0) return { kind: "plain", text: "0" };
  if (value >= 1) return { kind: "plain", text: value.toLocaleString("en-US", { maximumFractionDigits: 2 }) };
  const raw = value.toFixed(18);
  const match = raw.match(/^0\.(0+)([1-9]\d*)/);
  if (!match || match[1].length < 3) return { kind: "plain", text: value.toPrecision(4) };
  const digits = match[2].replace(/0+$/, "").slice(0, 4);
  return { kind: "sub", text: digits, zeros: match[1].length };
}

/** USD first when the feed is up. The HYPE amount is the secondary figure, or the only figure when the quote is missing. */
export function Price({ value, symbol, usd }: { value: number; symbol: string; usd?: number | null }) {
  const label = priceLabel(symbol, usd);
  const quoted = label.dollar && usd != null ? value * usd : null;
  const shown = tiny(quoted ?? value);
  const unit = label.dollar ? "$" : "";
  const suffix = label.dollar ? "" : label.suffix;
  const secondary = label.dollar ? ` · ${value.toPrecision(4)} ${symbol.trim()}` : "";
  if (shown.kind === "sub") {
    return (
      <>
        {unit}0.0<sub>{shown.zeros}</sub>
        {shown.text}
        {suffix}
        {secondary ? <span className="ghost">{secondary}</span> : null}
      </>
    );
  }
  return (
    <>
      {unit}
      {shown.text}
      {suffix}
      {secondary ? <span className="ghost">{secondary}</span> : null}
    </>
  );
}
