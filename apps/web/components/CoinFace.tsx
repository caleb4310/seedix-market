import Link from "next/link";
import { fees } from "@/lib/tokens";
import { type Mode } from "@/lib/coin";
import type { PairCategory } from "@/lib/registry";

export type CoinFace = {
  name: string;
  ticker: string;
  image: string | null;
  pairSymbol: string;
  pairLogo: string | null;
  pairTest?: boolean;
  category?: PairCategory | null;
  mode: Mode;
  mcap?: number;
  mcapUsd?: number | null;
  description?: string | null;
  x?: string | null;
  telegram?: string | null;
  website?: string | null;
  unverified?: boolean;
  age?: string;
  href?: string;
};

const categoryLabel: Record<PairCategory, string> = {
  stock: "Stock",
  preipo: "Pre-IPO",
  crypto: "Crypto",
};

function pill(mode: Mode): string {
  if (mode === "keep") return "Keep";
  if (mode === "kickback") return "Kickback";
  return "Burn";
}

function pct(pips: number): string {
  const value = pips / (fees.pips / 100);
  return Number.isInteger(value) ? `${value}%` : `${value}%`;
}

export function Avatar({ label, image }: { label: string; image: string | null }) {
  const letter = label.trim().slice(0, 1).toUpperCase();
  return (
    <span className="coin-avatar" aria-hidden="true">
      {image ? <img src={image} alt="" /> : letter ? <span>{letter}</span> : <span className="ghost"> </span>}
    </span>
  );
}

export function ModePill({ mode }: { mode: Mode }) {
  return (
    <span className="mode-pill" data-mode={mode}>
      {pill(mode)}
    </span>
  );
}

export function PairChip({
  symbol,
  logo,
  test,
  category,
}: {
  symbol: string;
  logo: string | null;
  test?: boolean;
  category?: PairCategory | null;
}) {
  const known = symbol.trim().length > 0;
  return (
    <span className="pair-chip">
      <span className="pair-logo" aria-hidden="true">
        {logo ? <img src={logo} alt="" /> : <span>{known ? symbol.slice(0, 1) : ""}</span>}
      </span>
      {known ? <span>{symbol}</span> : <span className="ghost">Pair</span>}
      {category ? <span className="pair-cat">{categoryLabel[category]}</span> : null}
      {test ? <span className="test-badge">TEST</span> : null}
    </span>
  );
}

export function SocialLinks({
  x,
  telegram,
  website,
}: {
  x?: string | null;
  telegram?: string | null;
  website?: string | null;
}) {
  if (!x && !telegram && !website) return null;
  return (
    <span className="preview-links">
      {x ? (
        <a className="icon-link" href={x} target="_blank" rel="noopener noreferrer nofollow" aria-label="X">
          <IconX />
        </a>
      ) : null}
      {telegram ? (
        <a className="icon-link" href={telegram} target="_blank" rel="noopener noreferrer nofollow" aria-label="Telegram">
          <IconSend />
        </a>
      ) : null}
      {website ? (
        <a className="icon-link" href={website} target="_blank" rel="noopener noreferrer nofollow" aria-label="Website">
          <IconWeb />
        </a>
      ) : null}
    </span>
  );
}

export function MarketCap({ amount, symbol, usd }: { amount?: number; symbol: string; usd?: number | null }) {
  if (amount === undefined || !symbol.trim()) return <span className="ghost">Market cap</span>;
  const usdText = usd !== null && usd !== undefined && Number.isFinite(usd) ? ` · $${usd.toLocaleString("en-US")}` : "";
  return (
    <span className="num">
      {amount.toLocaleString("en-US")} {symbol}
      {usdText}
    </span>
  );
}

export function CoinLine({ face }: { face: CoinFace }) {
  const name = face.name.trim();
  const ticker = face.ticker.trim();
  const identity = (
    <>
      <Avatar label={ticker || name} image={face.image} />
      <span className="coin-copy">
        {name ? <span className="name">{name}</span> : <span className="name ghost">Name</span>}
        {ticker ? <span className="ticker"> ${ticker}</span> : <span className="ticker ghost"> Ticker</span>}
      </span>
    </>
  );
  return (
    <div className="row">
      {face.href ? (
        <Link className="coin-cell" href={face.href}>
          {identity}
        </Link>
      ) : (
        <span className="coin-cell">{identity}</span>
      )}
      <span className="hide-sm pair-cell">
        <PairChip symbol={face.pairSymbol} logo={face.pairLogo} test={face.pairTest} />
        <SocialLinks x={face.x} telegram={face.telegram} website={face.website} />
      </span>
      <ModePill mode={face.mode} />
      <MarketCap amount={face.mcap} symbol={face.pairSymbol} usd={face.mcapUsd} />
      <span className="num hide-sm hide-md">{face.age ?? <span className="ghost">New</span>}</span>
    </div>
  );
}

export function CoinCard({ face }: { face: CoinFace }) {
  const name = face.name.trim();
  const ticker = face.ticker.trim();
  return (
    <div className="coin-card">
      <Avatar label={ticker || name} image={face.image} />
      <div className="coin-card-copy">
        {name ? <span className="name">{name}</span> : <span className="name ghost">Name</span>}
        {ticker ? <span className="ticker"> ${ticker}</span> : <span className="ticker ghost"> Ticker</span>}
        <span className="coin-card-meta">
          <PairChip symbol={face.pairSymbol} logo={face.pairLogo} test={face.pairTest} category={face.category} />
          <ModePill mode={face.mode} />
          {face.unverified ? <span className="unverified">Unverified token</span> : null}
        </span>
        <MarketCap amount={face.mcap} symbol={face.pairSymbol} usd={face.mcapUsd} />
        <SocialLinks x={face.x} telegram={face.telegram} website={face.website} />
      </div>
    </div>
  );
}

export function CoinHeader({ face }: { face: CoinFace }) {
  const name = face.name.trim();
  const ticker = face.ticker.trim();
  return (
    <header className="coin-header">
      <Avatar label={ticker || name} image={face.image} />
      <div className="coin-header-copy">
        <p className="kicker">
          <PairChip symbol={face.pairSymbol} logo={face.pairLogo} test={face.pairTest} category={face.category} />
          {face.unverified ? <span className="unverified">Unverified token</span> : null}
        </p>
        <h1>
          {name ? name : <span className="ghost">Name</span>}{" "}
          {ticker ? <span className="ticker">${ticker}</span> : <span className="ticker ghost">Ticker</span>}
        </h1>
        {face.description ? <p className="lede">{face.description}</p> : <p className="lede ghost">Description</p>}
        <div className="statline">
          <div>
            <span>Starting cap</span>
            <div className="num">
              <MarketCap amount={face.mcap} symbol={face.pairSymbol} usd={face.mcapUsd} />
            </div>
          </div>
          <div>
            <span>Mode</span>
            <ModePill mode={face.mode} />
          </div>
        </div>
        <SocialLinks x={face.x} telegram={face.telegram} website={face.website} />
        <dl className="review">
          <div>
            <dt>Platform</dt>
            <dd>{pct(fees.platformPips)}, split 50/50</dd>
          </div>
          <div>
            <dt>Hook fee</dt>
            <dd>
              {pct(fees.startPips)} to {pct(fees.endPips)} over {fees.decaySeconds}s
            </dd>
          </div>
          <div>
            <dt>LP</dt>
            <dd>{pct(fees.lpPips)}</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.7 10.3 21 3h-1.6l-5.5 6.4L9.2 3H3.5l6.6 9.6L3.5 21h1.6l5.8-6.7L14.8 21h5.7l-5.8-10.7Zm-2 2.4-.7-1-5.4-7.7h2.3l4.4 6.3.7 1 5.7 8.1h-2.3l-4.7-6.7Z" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.2 11.2 20.4 3.5c.7-.3 1.4.4 1.1 1.1l-7.7 17.2c-.3.7-1.3.6-1.5-.1l-2.1-6.6-6.6-2.1c-.7-.2-.8-1.2-.1-1.5Z" />
    </svg>
  );
}

function IconWeb() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 12h16M12 4c2.2 2.4 2.2 13.6 0 16M12 4c-2.2 2.4-2.2 13.6 0 16" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
