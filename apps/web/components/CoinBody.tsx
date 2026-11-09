"use client";

import { useEffect, useState } from "react";
import { fees, hookPips } from "@/lib/tokens";
import type { Coin } from "@/lib/mock";
import { modeLabel } from "@/lib/mock";
import { Price } from "@/components/Price";
import { Claims } from "@/components/TradePanel";

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function CoinBody({ coin }: { coin: Coin }) {
  const [now, setNow] = useState(coin.ageSec);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setNow((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const decaying = hookPips(now) > fees.endPips;
  return (
    <>
      <div className="coin-mobile-head">
        <p className="kicker">{coin.pair} pair</p>
        <h1>
          {coin.name} <span className="ticker">${coin.ticker}</span>
        </h1>
        <p className="num">
          <Price value={coin.price} />
        </p>
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
        <svg className="spark" viewBox="0 0 240 72" preserveAspectRatio="none" role="img" aria-label="Price over the last hour">
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
          <span className="addr-short">{shortAddress(coin.recipient)}</span>
          <span className="addr-full">{coin.recipient}</span>
          <button
            className="text-link copy-btn"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(coin.recipient).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
        <p className="copy">
          Creator {coin.creator}. {coin.holders} holders. The hook fee above 1% burns the coin for the first 10 seconds.
          The team can receive up to 5% of supply at launch, outside the pool. That allocation is the cheapest inventory.
        </p>
        <Claims coin={coin} />
      </section>
    </>
  );
}
