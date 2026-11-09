"use client";

import { useEffect, useState } from "react";
import { fees, hookPips } from "@/lib/tokens";
import { coinAge, modeLabel, type Coin } from "@/lib/coin";
import { Price } from "@/components/Price";
import { Chart } from "@/components/Chart";
import { Kickbacks } from "@/components/Kickbacks";

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function CoinBody({ coin }: { coin: Coin }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const age = coin.launchTime !== undefined ? coinAge(coin, now) : coin.ageSec;
  const decaying = hookPips(age) > fees.endPips;
  const contract = coin.tokenAddress ?? coin.recipient;
  return (
    <>
      <div className="coin-mobile-head">
        <p className="kicker">{coin.pair} pair</p>
        <h1>
          {coin.name} <span className="ticker">${coin.ticker}</span>
        </h1>
        {coin.price !== undefined ? (
          <p className="num">
            <Price value={coin.price} />
          </p>
        ) : null}
      </div>
      <section className="coin-main">
        <p className="kicker">{coin.pair} pair</p>
        <h1>
          {coin.name} <span className="ticker">${coin.ticker}</span>
        </h1>
        <p className="lede">
          {coin.description} {decaying ? "The decay is still running." : "The hook fee has settled at 1%."}
        </p>
        <div className="statline">
          {coin.price !== undefined ? (
            <div>
              <span>Price</span>
              <div className="num">
                <Price value={coin.price} />
              </div>
            </div>
          ) : null}
          {coin.mcap !== undefined ? (
            <div>
              <span>Market cap</span>
              <div className="num">${coin.mcap.toLocaleString("en-US")}</div>
            </div>
          ) : null}
          <div>
            <span>Mode</span>
            <div className="mode" data-mode={coin.mode}>
              {modeLabel(coin.mode)}
            </div>
          </div>
        </div>
        <Chart poolId={coin.poolId} />
        <p className="address-chip">
          <span>Contract</span>
          <span className="addr-short">{shortAddress(contract)}</span>
          <span className="addr-full">{contract}</span>
          <button
            className="text-link copy-btn"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(contract).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
        <p className="copy">
          {coin.creator ? `Creator ${coin.creator}. ` : null}
          {coin.holders !== undefined ? `${coin.holders} holders. ` : null}
          The hook fee above 1% burns the coin for the first 10 seconds. The team can receive up to 5% of supply at launch, outside the pool.
        </p>
        <Kickbacks poolId={coin.poolId} />
      </section>
    </>
  );
}
