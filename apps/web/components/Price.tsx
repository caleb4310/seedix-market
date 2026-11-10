import { priceLabel, spotFigure, type SpotFigure } from "@/lib/priceLabel";

function Figure({ fig }: { fig: SpotFigure }) {
  if (fig.kind === "sub") {
    return (
      <>
        0.0<sub>{fig.zeros}</sub>
        {fig.text}
      </>
    );
  }
  return <>{fig.text}</>;
}

/** USD first when the feed is up. The HYPE amount is the secondary figure, or the only figure when the quote is missing. */
export function Price({ value, symbol, usd }: { value: number; symbol: string; usd?: number | null }) {
  const label = priceLabel(symbol, usd);
  const quoted = label.dollar && usd != null ? value * usd : null;
  const shown = spotFigure(quoted ?? value);
  const unit = label.dollar ? "$" : "";
  const suffix = label.dollar ? "" : label.suffix;
  const secondary = label.dollar ? spotFigure(value) : null;
  return (
    <>
      {unit}
      <Figure fig={shown} />
      {suffix}
      {secondary ? (
        <span className="ghost">
          {" "}
          · <Figure fig={secondary} /> {symbol.trim()}
        </span>
      ) : null}
    </>
  );
}
