import type { Mode } from "@/lib/coin";
import { modeLabel } from "@/lib/coin";
import type { PairCategory } from "@/lib/registry";

export type PreviewModel = {
  name: string;
  ticker: string;
  image: string | null;
  pairSymbol: string;
  pairLogo: string | null;
  category: PairCategory | null;
  mode: Mode;
  mcap: number;
  usd: number | null;
  description: string;
  website: string | null;
  x: string | null;
  telegram: string | null;
  unverified: boolean;
};

const categoryLabel: Record<PairCategory, string> = {
  stock: "Stock",
  preipo: "Pre-IPO",
  crypto: "Crypto",
};

function IconLink({ href, label, children }: { href: string; label: string; children: string }) {
  return (
    <a className="icon-link" href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={label}>
      {children}
    </a>
  );
}

export function LaunchPreview({ model }: { model: PreviewModel }) {
  const name = model.name.trim() || "New coin";
  const ticker = model.ticker.trim() || "TICKER";
  const mcap = Number.isFinite(model.mcap) ? model.mcap : 0;
  return (
    <div className="preview">
      <p className="kicker">Board card</p>
      <div className="preview-card">
        <span className="mark" aria-hidden="true">
          {model.image ? <img src={model.image} alt="" /> : ticker.slice(0, 1)}
        </span>
        <span className="coin-copy">
          <span className="name">{name}</span>
          <span className="ticker"> ${ticker}</span>
        </span>
        <span className="preview-pair">
          <span className="mark pair-mark" aria-hidden="true">
            {model.pairLogo ? <img src={model.pairLogo} alt="" /> : model.pairSymbol.slice(0, 1)}
          </span>
          <span>
            <span className="ticker">{model.pairSymbol}</span>
            {model.category ? <span className="pair-cat">{categoryLabel[model.category]}</span> : null}
          </span>
        </span>
        <span className="mode" data-mode={model.mode}>
          {modeLabel(model.mode)}
        </span>
        {model.unverified ? <span className="unverified">Unverified token</span> : null}
        <span className="preview-links">
          {model.x ? <IconLink href={model.x} label="X">X</IconLink> : null}
          {model.telegram ? <IconLink href={model.telegram} label="Telegram">Tg</IconLink> : null}
          {model.website ? <IconLink href={model.website} label="Website">Web</IconLink> : null}
        </span>
      </div>

      <p className="kicker stack-top">Coin page</p>
      <div className="preview-head">
        <p className="kicker">{model.pairSymbol} pair{model.category ? ` · ${categoryLabel[model.category]}` : ""}</p>
        <h2>
          {name} <span className="ticker">${ticker}</span>
        </h2>
        {model.unverified ? <p className="unverified">Unverified token</p> : null}
        {model.description ? <p className="lede">{model.description}</p> : null}
        <p className="num">
          {mcap.toLocaleString("en-US")} {model.pairSymbol}
          {model.usd !== null ? ` · $${model.usd.toLocaleString("en-US")}` : ""}
        </p>
      </div>

      <dl className="review stack-top">
        <div>
          <dt>Platform</dt>
          <dd>1%, split 50/50</dd>
        </div>
        <div>
          <dt>Hook fee</dt>
          <dd>80% to 1% over 10s</dd>
        </div>
        <div>
          <dt>LP</dt>
          <dd>0.1%</dd>
        </div>
      </dl>
    </div>
  );
}
