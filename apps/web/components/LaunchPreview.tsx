import { logoSrc } from "@/lib/logoUrl";
import { launchCapLabel } from "@/lib/startCap";
import type { CoinFace } from "@/components/CoinFace";

export function LaunchPreview({
  face,
  cap,
  backing,
}: {
  face: CoinFace;
  cap: string;
  backing: string;
}) {
  const name = face.name.trim();
  const ticker = face.ticker.trim();
  const letter = (ticker || name).slice(0, 1).toUpperCase();
  const image = logoSrc(face.image);
  const mode = face.mode === "kickback" ? "Kickback" : face.mode === "burn" ? "Burn" : "Keep";
  return (
    <div className="preview">
      <p className="kicker">Live preview · this is what people will see</p>
      <article className="live-card">
        <div className="wall-art">
          {image ? <img src={image} alt="" /> : <span className="stripes">{letter || " "}</span>}
          <span className="flag" data-mode={face.mode}>
            {mode}
          </span>
        </div>
        <div className="live-copy">
          {name ? <h2>{name}</h2> : <h2 className="ghost">Name</h2>}
          {ticker ? <p className="ticker">${ticker}</p> : <p className="ticker ghost">$TICKER</p>}
          <p className="cap-line">
            {cap}
            {cap === "USD price unavailable" ? null : <span className="ghost"> at launch</span>}
          </p>
          <span className="pair-pill">{backing}</span>
        </div>
      </article>
      <p className="note">Your card on the wall. It updates as you type. Hook fee 80% to 1% over 10s.</p>
    </div>
  );
}
