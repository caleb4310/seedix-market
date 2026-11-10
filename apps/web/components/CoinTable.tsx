"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { backingLabel } from "@/lib/backing";
import type { Coin, Mode } from "@/lib/coin";
import { apiUrl } from "@/lib/api";
import { useBoard } from "@/lib/board";
import { useHypeUsd } from "@/lib/hype";
import { logoSrc } from "@/lib/logoUrl";
import { loadPairs, type ListedPair, type PairCategory } from "@/lib/registry";
import { formatUsdCompact } from "@/lib/startCap";

type Kind = "all" | PairCategory;

function money(raw: string | undefined, hypeUsd: number | null): string {
  if (!raw || !/^\d+$/.test(raw)) return hypeUsd == null ? "—" : "$0";
  const hype = Number(BigInt(raw) / 10n ** 15n) / 1000;
  if (hypeUsd == null) return `${hype.toLocaleString("en-US", { maximumFractionDigits: 2 })} HYPE`;
  return formatUsdCompact(hype * hypeUsd);
}

function age(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function kindOf(value: string | null): Kind {
  if (value === "stock" || value === "preipo" || value === "crypto") return value;
  return "all";
}

export function CoinTable() {
  const board = useBoard();
  const hypeUsd = useHypeUsd();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const kind = kindOf(params.get("kind"));
  const kick = params.get("kickback") === "1";
  const burners = params.get("burn") === "1";
  const sort = params.get("sort") === "new" ? "new" : "mcap";
  const query = params.get("q") ?? "";
  const [stats, setStats] = useState<{ coins: string; burned: string; kickback: string; volume24h: string } | null>(null);
  const [pairs, setPairs] = useState<ListedPair[]>([]);

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

  useEffect(() => {
    let cancel = false;
    loadPairs()
      .then((rows) => {
        if (!cancel) setPairs(rows);
      })
      .catch(() => {
        if (!cancel) setPairs([]);
      });
    return () => {
      cancel = true;
    };
  }, []);

  function write(next: { kind?: Kind; kick?: boolean; burn?: boolean; sort?: "mcap" | "new"; q?: string }) {
    const merged = {
      kind: next.kind ?? kind,
      kick: next.kick ?? kick,
      burn: next.burn ?? burners,
      sort: next.sort ?? sort,
      q: next.q ?? query,
    };
    const search = new URLSearchParams();
    if (merged.kind !== "all") search.set("kind", merged.kind);
    if (merged.kick) search.set("kickback", "1");
    if (merged.burn) search.set("burn", "1");
    if (merged.sort === "new") search.set("sort", "new");
    if (merged.q) search.set("q", merged.q);
    const text = search.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  const needle = query.trim().toLowerCase();
  const rows = board.coins
    .filter((coin) => kind === "all" || coin.category === kind)
    .filter((coin) => {
      if (!needle) return true;
      const listed = listedBacking(coin, pairs);
      return (
        coin.name.toLowerCase().includes(needle) ||
        coin.ticker.toLowerCase().includes(needle) ||
        listed.symbol.toLowerCase().includes(needle) ||
        (coin.tokenAddress ?? "").toLowerCase().includes(needle) ||
        (coin.backing ?? "").toLowerCase().includes(needle)
      );
    })
    .filter((coin) => {
      if (!kick && !burners) return true;
      if (kick && coin.mode === "kickback") return true;
      if (burners && coin.mode === "burn") return true;
      return false;
    })
    .sort((a, b) => (sort === "mcap" ? (b.mcap ?? 0) - (a.mcap ?? 0) : (b.launchTime ?? 0) - (a.launchTime ?? 0)));

  const kickCount = rows.filter((coin) => coin.mode === "kickback").length;
  const burnCount = rows.filter((coin) => coin.mode === "burn").length;

  return (
    <>
      <div className="filter-bar">
        <div className="seg" role="tablist" aria-label="Backing category">
          {(
            [
              ["all", "Everything"],
              ["stock", "Stocks"],
              ["preipo", "Pre-IPO"],
              ["crypto", "Crypto"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={kind === id} data-on={kind === id} onClick={() => write({ kind: id })}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="switch" role="switch" aria-checked={kick} data-on={kick} onClick={() => write({ kick: !kick })}>
          <span className="switch-knob" aria-hidden="true" />
          Kickback
        </button>
        <button type="button" className="switch" role="switch" aria-checked={burners} data-on={burners} onClick={() => write({ burn: !burners })}>
          <span className="switch-knob" aria-hidden="true" />
          Burners
        </button>
        <div className="seg" role="tablist" aria-label="Sort coins">
          <button type="button" role="tab" aria-selected={sort === "mcap"} data-on={sort === "mcap"} onClick={() => write({ sort: "mcap" })}>
            Market cap
          </button>
          <button type="button" role="tab" aria-selected={sort === "new"} data-on={sort === "new"} onClick={() => write({ sort: "new" })}>
            New
          </button>
        </div>
        <input
          className="coin-search"
          value={query}
          onChange={(event) => write({ q: event.target.value })}
          placeholder="Search ticker, name or pair"
          aria-label="Search ticker, name or pair"
        />
        <p className="count-line">
          {rows.length} coins · {kickCount} Kickback · {burnCount} Burners
        </p>
      </div>
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
      {board.status === "loading" ? (
        <div className="coin-grid" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="wall-card skeleton" />
          ))}
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
            {kind === "preipo" && board.coins.length === 0
              ? "No pre-IPO tokens on Elysium yet."
              : board.coins.length === 0
                ? "No coins yet. Launch the first one."
                : "No coins in this filter."}
          </p>
          {board.coins.length === 0 ? (
            <p className="stack-top">
              <Link className="btn" href="/launch">
                Launch a coin
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      {board.status === "ready" && rows.length > 0 ? (
        <div className="coin-grid">
          {rows.map((coin) => (
            <WallCard key={coin.id} coin={coin} pairs={pairs} hypeUsd={hypeUsd} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function listedBacking(coin: Coin, pairs: ListedPair[]): { symbol: string; logo: string | null } {
  const listed = pairs.find((pair) => coin.backing && pair.address.toLowerCase() === coin.backing.toLowerCase());
  const symbol = backingLabel({
    mode: coin.mode,
    pair: coin.pair,
    backingSymbol: coin.backingSymbol || listed?.symbol,
  });
  const logo = coin.mode === "burn" ? null : logoSrc(coin.backingLogo || listed?.logo || null);
  return { symbol, logo };
}

function WallCard({ coin, pairs, hypeUsd }: { coin: Coin; pairs: ListedPair[]; hypeUsd: number | null }) {
  const backing = listedBacking(coin, pairs);
  const usd = coin.mcap !== undefined && hypeUsd != null ? coin.mcap * hypeUsd : coin.mcapUsd;
  const letter = (coin.ticker || coin.name).trim().slice(0, 1).toUpperCase();
  const image = logoSrc(coin.image);
  const ago = age(coin.launchTime !== undefined ? Math.max(0, Math.floor(Date.now() / 1000) - coin.launchTime) : coin.ageSec);
  return (
    <Link className="wall-card" href={`/coin/${coin.id}`}>
      <span className="wall-art">
        {image ? <img src={image} alt="" /> : <span className="stripes">{letter}</span>}
        {coin.mode === "kickback" ? <span className="flag" data-mode="kickback">Kickback</span> : null}
        {coin.mode === "burn" ? <span className="flag" data-mode="burn">Burn</span> : null}
      </span>
      <span className="wall-copy">
        <span className="name">{coin.name}</span>
        <span className="ticker">${coin.ticker}</span>
        <strong className="cap-line">
          {usd != null && Number.isFinite(usd) && usd > 0
            ? `${formatUsdCompact(usd)} MC`
            : coin.mcap !== undefined
              ? `${coin.mcap.toLocaleString("en-US", { maximumFractionDigits: 0 })} HYPE`
              : "Market cap"}
        </strong>
        <span className="wall-meta">
          <span className="pair-pill">{backing.symbol}</span>
          <span className="ago">{ago}</span>
        </span>
      </span>
    </Link>
  );
}
