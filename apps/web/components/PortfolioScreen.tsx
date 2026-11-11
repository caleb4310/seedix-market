"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { apiUrl, getPortfolio, kickbackKind, type Portfolio } from "@/lib/api";
import { formatTokenAmount } from "@/lib/amounts";

function amountLabel(amount: string): string {
  try {
    return formatTokenAmount(BigInt(amount), 18);
  } catch {
    return amount;
  }
}

function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function PortfolioScreen() {
  const { address, status } = useAccount();
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiUrl || !address) return;
    let cancel = false;
    getPortfolio(address)
      .then((body) => {
        if (!cancel) setData(body);
      })
      .catch(() => {
        if (!cancel) setError("Your portfolio is unavailable.");
      });
    return () => {
      cancel = true;
    };
  }, [address]);

  if (!apiUrl) {
    return (
      <div className="state-page">
        <p className="kicker">Portfolio</p>
        <h1>Your coins</h1>
        <p className="lede">The API is not configured, so this page has no balances to show.</p>
      </div>
    );
  }
  if (status !== "connected" || !address) {
    return (
      <div className="state-page">
        <p className="kicker">Portfolio</p>
        <h1>Your coins</h1>
        <p className="lede">Connect a wallet to see balances, trades, and Kickback history.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="state-page">
        <p className="lede">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="state-page">
        <p className="lede">Loading your portfolio.</p>
      </div>
    );
  }
  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Portfolio</p>
          <h1>Your coins</h1>
          <p className="lede">
            <span className="addr-short">{short(address)}</span>
            <span className="addr-full">{address}</span>
          </p>
        </div>
      </div>
      <section className="activity">
        <h2>Balances</h2>
        {data.balances.length === 0 ? <p className="lede">No coin balances yet.</p> : null}
        {data.balances.map((row) => (
          <Link key={row.poolId} href={`/coin/${row.poolId}`} className="activity-row">
            <span>
              {row.name} <span className="ticker">${row.symbol}</span>
            </span>
            <span className="num">{amountLabel(row.balance)}</span>
          </Link>
        ))}
      </section>
      <section className="activity">
        <h2>Trades</h2>
        {data.swaps.length === 0 ? <p className="lede">No trades yet.</p> : null}
        {data.swaps.map((row) => (
          <p key={row.txHash} className="activity-row">
            <span>{row.zeroForOne ? "Sell" : "Buy"}</span>
            <span className="num">{row.price}</span>
            <span className="addr-short">{short(row.txHash)}</span>
          </p>
        ))}
      </section>
      <section className="activity">
        <h2>Kickbacks</h2>
        <p className="note">Paid to your wallet automatically. Gas comes out of the round.</p>
        {data.kickbacks.length === 0 ? <p className="lede">No Kickback payments yet.</p> : null}
        {data.kickbacks.map((row) => (
          <p key={`${row.txHash}-${row.kind}-${row.epoch}`} className="activity-row">
            <span>{kickbackKind(row.kind)}</span>
            <span className="num">{amountLabel(row.amount)}</span>
          </p>
        ))}
      </section>
    </>
  );
}
