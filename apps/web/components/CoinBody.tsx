"use client";

import { useEffect, useState, type ReactNode } from "react";
import { backingLabel } from "@/lib/backing";
import { coinAge, type Coin } from "@/lib/coin";
import { explorerAddress } from "@/lib/deployment";
import { useHypeUsd } from "@/lib/hype";
import { logoSrc } from "@/lib/logoUrl";
import { formatUsdCompact } from "@/lib/startCap";
import { Price } from "@/components/Price";
import { Chart } from "@/components/Chart";
import { Kickbacks } from "@/components/Kickbacks";

const categoryLabel = { stock: "Stock", preipo: "Pre-IPO", crypto: "Crypto" } as const;

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function ageLabel(sec: number): string {
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function CoinBody({ coin, trade }: { coin: Coin; trade?: ReactNode }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [copied, setCopied] = useState(false);
  const hypeUsd = useHypeUsd();
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const age = coin.launchTime !== undefined ? coinAge(coin, now) : coin.ageSec;
  const contract = coin.tokenAddress ?? coin.recipient;
  const backing = backingLabel({ mode: coin.mode, pair: coin.pair, backingSymbol: coin.backingSymbol });
  const image = logoSrc(coin.image);
  const letter = (coin.ticker || coin.name).trim().slice(0, 1).toUpperCase();
  const usd = coin.mcap !== undefined && hypeUsd != null ? coin.mcap * hypeUsd : coin.mcapUsd;
  const category = coin.mode === "burn" ? "Burn" : coin.category ? categoryLabel[coin.category] : null;
  return (
    <>
      <section className="coin-stage">
        <div className="coin-poster">
          {image ? <img src={image} alt="" /> : <span className="stripes">{letter}</span>}
        </div>
        <div className="coin-facts">
          <h1 className="ticker-hero">${coin.ticker}</h1>
          <p className="backed">
            {coin.mode === "burn" ? "Burn" : `Backed by ${backing}`}
            {coin.price !== undefined ? (
              <>
                {" "}
                · <Price value={coin.price} symbol="HYPE" usd={hypeUsd} />
              </>
            ) : null}
          </p>
          {category ? <span className="tag">{category}</span> : null}
          <dl className="fact-row">
            <div>
              <dt>Price</dt>
              <dd>{coin.price !== undefined ? <Price value={coin.price} symbol="HYPE" usd={hypeUsd} /> : "—"}</dd>
            </div>
            <div>
              <dt>Market cap</dt>
              <dd>
                {usd != null && Number.isFinite(usd) && usd > 0
                  ? formatUsdCompact(usd)
                  : coin.mcap !== undefined
                    ? `${coin.mcap.toLocaleString("en-US", { maximumFractionDigits: 0 })} HYPE`
                    : "—"}
              </dd>
            </div>
            <div>
              <dt>Launched</dt>
              <dd>{ageLabel(age)}</dd>
            </div>
            <div>
              <dt>By</dt>
              <dd>{coin.creator ? shortAddress(coin.creator) : shortAddress(coin.recipient)}</dd>
            </div>
            <div>
              <dt>Pair</dt>
              <dd>{backing}</dd>
            </div>
          </dl>
          {trade}
          <p className="contract-link">
            <a href={explorerAddress(contract)} target="_blank" rel="noopener noreferrer">
              Contract and pool records
            </a>
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
            <span className="addr-full">{contract}</span>
          </p>
        </div>
      </section>
      <Chart poolId={coin.poolId} />
      <Kickbacks poolId={coin.poolId} />
    </>
  );
}
