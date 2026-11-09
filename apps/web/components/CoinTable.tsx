"use client";

import Link from "next/link";
import { useState } from "react";
import { modeLabel, type Mode } from "@/lib/coin";
import type { PairCategory } from "@/lib/registry";
import { useBoard } from "@/lib/board";
import { Tabs } from "@/components/ui/Tabs";

function age(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function CoinTable() {
  const board = useBoard();
  const [filter, setFilter] = useState<"all" | Mode>("all");
  const [category, setCategory] = useState<"all" | PairCategory>("all");
  const rows = board.coins.filter(
    (c) => (category === "all" || c.category === category) && (filter === "all" || c.mode === filter),
  );
  const showMcap = board.coins.some((c) => c.mcap !== undefined);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Board</p>
          <h1>Coins</h1>
          <p className="lede">
            {board.status === "ready" && board.coins.length === 0
              ? "No coins yet. Launch the first one."
              : "Pick a coin to trade, or launch your own."}
          </p>
        </div>
        <div className="filter-col">
        <Tabs
          label="Pair category"
          size="sm"
          value={category}
          onChange={setCategory}
          options={[
            { id: "all", label: "All" },
            { id: "stock", label: "Stocks" },
            { id: "preipo", label: "Pre-IPO" },
            { id: "crypto", label: "Crypto" },
          ]}
        />
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
      </div>
      <div className="board">
        <div className="head">
          <span>Coin</span>
          <span className="hide-sm">Pair</span>
          <span>Mode</span>
          {showMcap ? <span className="num">Mcap</span> : null}
          <span className="num hide-sm hide-md">Age</span>
        </div>
        {board.status === "loading" ? (
          <div className="empty">
            <p className="lede">Loading coins from the testnet.</p>
          </div>
        ) : null}
        {board.status === "error" ? (
          <div className="empty">
            <p className="lede">{board.error}</p>
          </div>
        ) : null}
        {board.status === "ready" && rows.length === 0 ? (
          <div className="empty">
            <p className="lede">
              {category === "preipo"
                ? "No pre-IPO tokens on Elysium yet."
                : board.coins.length === 0
                  ? "No coins yet. Launch the first one."
                  : "No coins in this filter. Choose another mode, or launch one."}
            </p>
            {board.coins.length === 0 ? (
              <p className="stack-top">
                <Link className="btn" href="/launch">
                  Launch
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
        {board.status === "ready"
          ? rows.map((coin) => (
              <div key={coin.id} className="row">
                <Link className="coin-cell" href={`/coin/${coin.id}`}>
                  <span className="mark" data-tone={coin.ticker.length % 4}>
                    {coin.ticker.slice(0, 1)}
                  </span>
                  <span className="coin-copy">
                    <span className="name">{coin.name}</span>
                    <span className="ticker"> ${coin.ticker}</span>
                  </span>
                </Link>
                <span className="hide-sm preview-links">
                  {coin.pair}
                  {coin.x ? <a className="icon-link" href={coin.x} target="_blank" rel="noopener noreferrer nofollow">X</a> : null}
                  {coin.telegram ? <a className="icon-link" href={coin.telegram} target="_blank" rel="noopener noreferrer nofollow">Tg</a> : null}
                  {coin.website ? <a className="icon-link" href={coin.website} target="_blank" rel="noopener noreferrer nofollow">Web</a> : null}
                </span>
                <span className="mode" data-mode={coin.mode}>
                  {modeLabel(coin.mode)}
                </span>
                {showMcap ? <span className="num">{coin.mcap !== undefined ? `$${coin.mcap.toLocaleString("en-US")}` : "—"}</span> : null}
                <span className="num hide-sm hide-md">{age(coin.launchTime !== undefined ? Math.max(0, Math.floor(Date.now() / 1000) - coin.launchTime) : coin.ageSec)}</span>
              </div>
            ))
          : null}
      </div>
    </>
  );
}
