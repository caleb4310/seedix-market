"use client";

import { useEffect, useState } from "react";
import { hookPips } from "@/lib/tokens";
import { modeLabel, type Coin } from "@/lib/mock";

function pct(pips: number): string {
  return `${(pips / 10_000).toFixed(2)}%`;
}

export function TradePanel({ coin }: { coin: Coin }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [now, setNow] = useState(coin.ageSec);

  useEffect(() => {
    const id = window.setInterval(() => setNow((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = now;
  const hook = hookPips(elapsed);
  const platform = 10_000;
  const gross = Number(amount) || 0;
  const hookAmt = (gross * hook) / 1_000_000;
  const platAmt = (gross * platform) / 1_000_000;
  const toPool = Math.max(0, gross - hookAmt - platAmt);
  const lp = (toPool * 1_000) / 1_000_000;
  const unit = side === "buy" ? coin.pair : coin.ticker;

  return (
    <aside className="panel">
      <div className="seg">
        <button type="button" data-on={side === "buy"} onClick={() => setSide("buy")}>
          Buy
        </button>
        <button type="button" data-on={side === "sell"} onClick={() => setSide("sell")}>
          Sell
        </button>
      </div>
      <label>
        <span className="lbl">Amount · {unit}</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </label>
      <p className="kicker" style={{ marginTop: 16 }}>
        Hook fee now <span className="decay">{pct(hook)}</span>
        {elapsed < 10 ? " · still decaying" : " · settled at 1%"}
      </p>
      <dl className="receipt">
        <div>
          <dt>Platform 1%</dt>
          <dd>
            {platAmt.toFixed(2)} {coin.pair}
          </dd>
        </div>
        <div>
          <dt>Hook {pct(hook)}</dt>
          <dd>
            {hookAmt.toFixed(2)} {unit}
          </dd>
        </div>
        <div>
          <dt>LP 0.10%</dt>
          <dd>
            {lp.toFixed(3)} {unit}
          </dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{modeLabel(coin.mode)}</dd>
        </div>
      </dl>
      <button className="btn accent" type="button" style={{ width: "100%" }}>
        Sign {side}
      </button>
      <p className="lede" style={{ fontSize: 13 }}>
        The three lines above are what this trade pays. Signing is shown here; the contract call lands with the testnet deploy.
      </p>
    </aside>
  );
}

export function Claims({ coin }: { coin: Coin }) {
  const pots =
    coin.mode === "keep"
      ? [
          ["Creator pair", "12.40 " + coin.pair],
          ["Creator coin", "0 " + coin.ticker],
        ]
      : coin.mode === "kickback"
        ? [
            ["Kickback round", "8.10 " + coin.pair],
            ["Creator coin", "1.02 " + coin.ticker],
          ]
        : [
            ["Burn pair", "6.55 " + coin.pair],
            ["Burn coin", "440 " + coin.ticker],
          ];
  return (
    <section className="claims">
      <p className="kicker">Claim</p>
      {pots.map(([label, amount]) => (
        <div className="claim" key={label}>
          <div>
            <strong>{label}</strong>
            <div className="ticker">{amount}</div>
          </div>
          <button className="btn secondary" type="button">
            Claim
          </button>
        </div>
      ))}
    </section>
  );
}
