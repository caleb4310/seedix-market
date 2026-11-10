"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { modeLabel, type Mode } from "@/lib/coin";
import type { PairCategory } from "@/lib/registry";
import { apiUrl } from "@/lib/api";
import { useBoard } from "@/lib/board";
import { useHypeUsd } from "@/lib/hype";
import { CoinLine } from "@/components/CoinFace";
import { Tabs } from "@/components/ui/Tabs";

function money(raw: string | undefined, hypeUsd: number | null): string {
  if (!raw || !/^\d+$/.test(raw)) return hypeUsd == null ? "—" : "$0";
  const hype = Number(BigInt(raw) / 10n ** 15n) / 1000;
  if (hypeUsd == null) return `${hype.toLocaleString("en-US", { maximumFractionDigits: 2 })} HYPE`;
  return `$${(hype * hypeUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function age(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function CoinTable() {
  const board = useBoard();
  const hypeUsd = useHypeUsd();
  const [filter, setFilter] = useState<"all" | Mode>("all");
  const [category, setCategory] = useState<"all" | PairCategory>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"new" | "mcap" | "volume">("new");
  const [stats, setStats] = useState<{ coins: string; burned: string; kickback: string; volume24h: string } | null>(null);
  useEffect(() => {
    if (!apiUrl) return;
    let cancel = false;
    fetch(`${apiUrl}/stats`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancel && body) setStats(body);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);
  const needle = query.trim().toLowerCase();
  const rows = board.coins
    .filter((c) => (category === "all" || c.category === category) && (filter === "all" || c.mode === filter))
    .filter((c) => {
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.ticker.toLowerCase().includes(needle) ||
        (c.tokenAddress ?? "").toLowerCase().includes(needle)
      );
    })
    .sort((a, b) =>
      sort === "mcap" ? (b.mcap ?? 0) - (a.mcap ?? 0) : sort === "volume" ? (b.volume ?? 0) - (a.volume ?? 0) : (b.launchTime ?? 0) - (a.launchTime ?? 0),
    );
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
      </div>
      <div className="board-tools">
        <input
          className="coin-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, ticker, or contract"
          aria-label="Search coins"
        />
        <div className="stats-strip" aria-label="Market stats">
          <div className="stat-card">
            <span>Tokens</span>
            <strong>{stats?.coins ?? String(board.coins.length)}</strong>
          </div>
          <div className="stat-card">
            <span>Kickback</span>
            <strong>{money(stats?.kickback, hypeUsd)}</strong>
          </div>
          <div className="stat-card">
            <span>Burned</span>
            <strong>{money(stats?.burned, hypeUsd)}</strong>
          </div>
          <div className="stat-card">
            <span>24h volume</span>
            <strong>{money(stats?.volume24h, hypeUsd)}</strong>
          </div>
        </div>
        <div className="filter-row">
          <span className="lbl">Backing</span>
          <Tabs
            label="Backing category"
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
        </div>
        <div className="filter-row">
          <span className="lbl">Mode</span>
          <Tabs
            label="Fee mode"
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
        <div className="filter-row">
          <span className="lbl">Sort</span>
          <Tabs
            label="Sort coins"
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { id: "new", label: "New" },
              { id: "mcap", label: "Market cap" },
              { id: "volume", label: "Volume" },
            ]}
          />
        </div>
      </div>
      <div className="board">
        <div className="head">
          <span>Coin</span>
          <span className="hide-sm">Pair</span>
          <span>Mode</span>
          <span className="num">Mcap</span>
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
              <CoinLine
                key={coin.id}
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
                  mcapUsd: coin.mcap !== undefined && hypeUsd != null ? coin.mcap * hypeUsd : coin.mcapUsd,
                  startMcap: coin.startMcap,
                  x: coin.x,
                  telegram: coin.telegram,
                  website: coin.website,
                  age: age(coin.launchTime !== undefined ? Math.max(0, Math.floor(Date.now() / 1000) - coin.launchTime) : coin.ageSec),
                  href: `/coin/${coin.id}`,
                }}
              />
            ))
          : null}
      </div>
    </>
  );
}
