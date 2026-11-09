import { CoinCard, CoinHeader, type CoinFace } from "@/components/CoinFace";

export function LaunchPreview({ face }: { face: CoinFace }) {
  return (
    <div className="preview">
      <p className="kicker">Board card</p>
      <CoinCard face={face} />
      <p className="kicker stack-top">Coin page</p>
      <CoinHeader face={face} />
    </div>
  );
}
