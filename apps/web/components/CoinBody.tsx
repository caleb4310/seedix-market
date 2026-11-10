"use client";

import { useEffect, useState } from "react";
import { fees, hookPips } from "@/lib/tokens";
import { coinAge, type Coin } from "@/lib/coin";
import { CoinHeader } from "@/components/CoinFace";
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
      <section className="coin-main">
        <CoinHeader
          face={{
            name: coin.name,
            ticker: coin.ticker,
            image: coin.image ?? null,
            pairSymbol: coin.pair,
            pairLogo: coin.pairLogo ?? null,
            pairTest: coin.pairTest,
            category: coin.category,
            mode: coin.mode,
            mcap: coin.mcap,
            mcapUsd: coin.mcapUsd,
            startMcap: coin.startMcap,
            startMcapUsd: coin.pairUsd != null && coin.startMcap !== undefined ? coin.startMcap * coin.pairUsd : null,
            description: `${coin.description} ${decaying ? "The decay is still running." : "The hook fee has settled at 1%."}`,
            x: coin.x,
            telegram: coin.telegram,
            website: coin.website,
          }}
        />
        {coin.price !== undefined ? (
          <p className="num">
            <Price value={coin.price} symbol={coin.pair} usd={coin.pairUsd} />
          </p>
        ) : null}
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
