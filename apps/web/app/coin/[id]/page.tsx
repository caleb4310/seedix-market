import { notFound } from "next/navigation";
import { Claims, TradePanel } from "@/components/TradePanel";
import { getCoin, modeLabel } from "@/lib/mock";
import { Price } from "@/components/Price";

function contractLabel(id: string): string {
  let hash = 0x4c1a9e20;
  for (const char of id) hash = Math.imul(hash, 33) + char.charCodeAt(0);
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `0x${hex.slice(0, 4)}…${hex.slice(4)}`;
}

export default async function CoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ side?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const coin = getCoin(id);
  if (!coin) notFound();
  const side = query.side === "sell" ? "sell" : "buy";
  return (
    <div className="coin-layout">
      <section>
        <p className="kicker">{coin.pair} pair</p>
        <h1>
          {coin.name} <span className="ticker">${coin.ticker}</span>
        </h1>
        <p className="lede">{coin.description}</p>
        <div className="statline">
          <div>
            <span>Price</span>
            <div className="num">
              <Price value={coin.price} />
            </div>
          </div>
          <div>
            <span>Market cap</span>
            <div className="num">${coin.mcap.toLocaleString("en-US")}</div>
          </div>
          <div>
            <span>Mode</span>
            <div className="mode" data-mode={coin.mode}>
              {modeLabel(coin.mode)}
            </div>
          </div>
        </div>
        <svg className="spark" viewBox="0 0 240 72" role="img" aria-label="Price over the last hour">
          <path
            d="M0 52 C 20 50, 30 46, 48 44 S 80 28, 100 34 S 140 58, 168 40 S 210 18, 240 22 V 72 H 0 Z"
            fill="currentColor"
            opacity="0.12"
          />
          <path
            d="M0 52 C 20 50, 30 46, 48 44 S 80 28, 100 34 S 140 58, 168 40 S 210 18, 240 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <p className="address-chip">
          <span>Contract</span>
          <span>{contractLabel(coin.id)}</span>
        </p>
        <p className="copy">
          Creator {coin.creator}. {coin.holders} holders. The hook fee above 1% burns the coin for the first 10 seconds.
          The team can receive up to 5% of supply at launch, outside the pool. That allocation is the cheapest inventory.
        </p>
        <Claims coin={coin} />
      </section>
      <TradePanel coin={coin} initialSide={side} />
    </div>
  );
}
