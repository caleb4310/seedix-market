"use client";

import { useEffect, useState } from "react";
import { hookPips, fees } from "@/lib/tokens";
import { modeLabel, type Coin } from "@/lib/mock";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import {
  DEFAULT_SLIPPAGE_PCT,
  formatAmount,
  formatImpact,
  tradeQuote,
  type Side,
} from "@/lib/quote";

function pct(pips: number): string {
  return `${(pips / 10_000).toFixed(2)}%`;
}

export function TradePanel({ coin, initialSide = "buy" }: { coin: Coin; initialSide?: Side }) {
  const [side, setSide] = useState<Side>(initialSide);
  const [amount, setAmount] = useState(side === "buy" ? "100" : "1000");
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PCT));
  const [now, setNow] = useState(coin.ageSec);
  const [confirmed, setConfirmed] = useState(false);
  const [signed, setSigned] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const id = window.setInterval(() => setNow((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setConfirmed(false);
    setSigned(false);
  }, [side, amount, slippage, coin.id]);

  const elapsed = now;
  const hook = hookPips(elapsed);
  const decaying = hook > fees.endPips;
  const left = Math.max(0, fees.decaySeconds - elapsed);
  const gross = Number(amount) || 0;
  const slip = Number(slippage);
  const slipPct = Number.isFinite(slip) ? slip : DEFAULT_SLIPPAGE_PCT;
  const quote = tradeQuote({
    side,
    amount: gross,
    price: coin.price,
    mcap: coin.mcap,
    hookPips: hook,
    slippagePct: slipPct,
  });
  const receiveUnit = quote.receiveUnit === "coin" ? coin.ticker : coin.pair;
  const hookUnit = quote.hookUnit === "coin" ? coin.ticker : coin.pair;
  const needsConfirm = side === "buy" && decaying;
  const canSign = gross > 0 && (!needsConfirm || confirmed);

  return (
    <Card className="trade">
      <Tabs
        label="Trade side"
        value={side}
        onChange={setSide}
        options={[
          { id: "buy", label: "Buy" },
          { id: "sell", label: "Sell" },
        ]}
      />
      <Field label={`Amount · ${side === "buy" ? coin.pair : coin.ticker}`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </Field>
      <Field label="Slippage" className="stack-top">
        <span className="suffix">
          <input
            className="narrow-input"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            inputMode="decimal"
            aria-label="Slippage percent"
          />
          <span>%</span>
        </span>
      </Field>
      {needsConfirm ? (
        <div className="fee-warn" role="alert">
          <strong>Hook fee is {pct(hook)}</strong>
          <p>
            Fee drops to 1% in {left}s. You pay {formatAmount(quote.hookAmt)} {coin.pair} to the hook on this buy, on top of the 1% platform fee.
          </p>
        </div>
      ) : (
        <p className="kicker stack-top">
          Hook fee now <span className="decay">{pct(hook)}</span>
          {elapsed < fees.decaySeconds ? " · still decaying" : " · settled at 1%"}
        </p>
      )}
      <dl className="receipt">
        <div>
          <dt>{side === "sell" ? "You receive" : "You receive ≈"}</dt>
          <dd>
            {formatAmount(quote.received)} {receiveUnit}
          </dd>
        </div>
        <div>
          <dt>Min received · {slipPct || 0}% slippage</dt>
          <dd>
            {formatAmount(quote.minReceived)} {receiveUnit}
          </dd>
        </div>
        <div>
          <dt>Price impact</dt>
          <dd>{formatImpact(quote.impact)}</dd>
        </div>
        <div>
          <dt>Platform 1%</dt>
          <dd>
            {formatAmount(quote.platAmt)} {coin.pair}
          </dd>
        </div>
        <div>
          <dt>Hook {pct(hook)}</dt>
          <dd>
            {formatAmount(quote.hookAmt)} {hookUnit}
          </dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{modeLabel(coin.mode)}</dd>
        </div>
      </dl>
      {needsConfirm ? (
        <label className="confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>Buy anyway at {pct(hook)}. I know most of this order is the fee.</span>
        </label>
      ) : null}
      <Button
        variant="accent"
        block
        type="button"
        disabled={!canSign}
        onClick={() => {
          setSigned(true);
          toast(`Signed ${side}. Minimum ${formatAmount(quote.minReceived)} ${receiveUnit}.`);
        }}
      >
        {needsConfirm && !confirmed ? `Confirm ${pct(hook)} fee` : signed ? "Signed" : `Sign ${side}`}
      </Button>
      <p className="note">
        {signed
          ? `Order uses min ${formatAmount(quote.minReceived)} ${receiveUnit}, a 20 minute deadline, and a price limit inside the pool.`
          : "Min received, the deadline, and a price limit are sent with the swap. A missing limit is rejected."}
      </p>
    </Card>
  );
}

export function Claims({ coin }: { coin: Coin }) {
  const pots =
    coin.mode === "keep"
      ? [
          ["Creator pair", "12.40 " + coin.pair, "Claim"],
          ["Creator coin", "0 " + coin.ticker, "Claim"],
        ]
      : coin.mode === "kickback"
        ? [
            ["Kickback round", "In review", "After review"],
            ["Creator coin", "1.02 " + coin.ticker, "Claim"],
          ]
        : [
            ["Burn pair", "6.55 " + coin.pair, "Queued"],
            ["Burn coin", "440 " + coin.ticker, "Burn"],
          ];
  return (
    <section className="claims">
      <p className="kicker">Fee recipient</p>
      <p className="note">
        Claims open for the fee recipient wallet. Burn pots are not a claim. Kickback pays holders after the review hour.
      </p>
      {pots.map(([label, amount, action]) => (
        <div className="claim" key={label}>
          <div>
            <strong>{label}</strong>
            <div className="ticker">{amount}</div>
          </div>
          <Button variant="secondary" type="button" disabled={action === "Queued" || action === "After review"}>
            {action}
          </Button>
        </div>
      ))}
    </section>
  );
}
