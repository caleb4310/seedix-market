import { notFound } from "next/navigation";
import { Claims, TradePanel } from "@/components/TradePanel";
import { getCoin, modeLabel } from "@/lib/mock";

export default async function CoinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const coin = getCoin(id);
  if (!coin) notFound();
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
            <div className="num">${coin.price.toFixed(6)}</div>
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
        <p>
          Creator {coin.creator}. {coin.holders} holders. The hook fee above 1% burns the coin for the first 10 seconds.
        </p>
        <Claims coin={coin} />
      </section>
      <TradePanel coin={coin} />
    </div>
  );
}
