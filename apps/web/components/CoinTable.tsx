"use client";

import Link from "next/link";
import { useState } from "react";
import { coins, modeLabel, type Mode } from "@/lib/mock";
import { Tabs } from "@/components/ui/Tabs";

function age(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function CoinTable() {
  const [filter, setFilter] = useState<"all" | Mode>("all");
  const rows = coins.filter((c) => filter === "all" || c.mode === filter);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Board</p>
          <h1>Coins</h1>
          <p className="lede">Eight live test coins. Pick one to trade, or launch your own.</p>
        </div>
        <Tabs
          label="Coin mode"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All" },
            { id: "keep", label: modeLabel("keep") },
            { id: "kickback", label: modeLabel("kickback") },
            { id: "burn", label: modeLabel("burn") },
          ]}
        />
      </div>
      <div className="board">
        <div className="head">
          <span>Coin</span>
          <span className="hide-sm">Pair</span>
          <span>Mode</span>
          <span className="num">Mcap</span>
          <span className="num hide-sm hide-md">Age</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            <p className="kicker">Empty</p>
            <p className="lede">No coins in this filter. Choose another mode, or launch one.</p>
          </div>
        ) : null}
        {rows.map((coin) => (
          <Link key={coin.id} href={`/coin/${coin.id}`} className="row">
            <span className="coin-cell">
              <span className="mark" data-tone={coin.ticker.length % 4}>
                {coin.ticker.slice(0, 1)}
              </span>
              <span className="coin-copy">
                <span className="name">{coin.name}</span>
                <span className="ticker"> ${coin.ticker}</span>
              </span>
            </span>
            <span className="hide-sm">{coin.pair}</span>
            <span className="mode" data-mode={coin.mode}>
              {modeLabel(coin.mode)}
            </span>
            <span className="num">{money(coin.mcap)}</span>
            <span className="num hide-sm hide-md">{age(coin.ageSec)}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
