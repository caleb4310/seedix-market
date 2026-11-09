"use client";

import Link from "next/link";
import { CoinBody } from "@/components/CoinBody";
import { TradePanel, type TradePreview } from "@/components/TradePanel";
import type { Side } from "@/lib/quote";
import { useBoard } from "@/lib/board";

export function CoinScreen({ id, side, preview }: { id: string; side: Side; preview?: TradePreview }) {
  const board = useBoard();
  const coin = board.coins.find((item) => item.id === id || item.tokenAddress?.toLowerCase() === id.toLowerCase());

  if (board.status === "loading") {
    return (
      <div className="state-page">
        <p className="lede">Loading this coin.</p>
      </div>
    );
  }
  if (board.status === "error") {
    return (
      <div className="state-page">
        <p className="lede">{board.error}</p>
      </div>
    );
  }
  if (!coin) {
    return (
      <div className="state-page">
        <p className="kicker">404</p>
        <h1>That page is not on Seedix</h1>
        <p className="lede">The coin or route does not exist. The board is the place to start.</p>
        <p className="stack-top">
          <Link className="btn" href="/">
            Back to coins
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="coin-layout">
      <CoinBody coin={coin} />
      <TradePanel coin={coin} initialSide={side} preview={preview} />
    </div>
  );
}
