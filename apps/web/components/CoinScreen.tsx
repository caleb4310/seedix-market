"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { CoinBody } from "@/components/CoinBody";
import { TradePanel } from "@/components/TradePanel";
import { appChain } from "@/lib/chain";
import type { Coin } from "@/lib/coin";
import { readLaunchedCoin } from "@/lib/launched";
import type { Side } from "@/lib/quote";
import { useBoard } from "@/lib/board";

const poolId = /^0x[0-9a-fA-F]{64}$/;

export function CoinScreen({ id, side }: { id: string; side: Side }) {
  const board = useBoard();
  const client = usePublicClient({ chainId: appChain.id });
  const listed = board.coins.find((item) => item.id === id || item.tokenAddress?.toLowerCase() === id.toLowerCase());
  const [live, setLive] = useState<Coin | null>(null);
  const [phase, setPhase] = useState<"wait" | "missing" | "error">("wait");

  useEffect(() => {
    if (listed || !poolId.test(id)) return;
    let cancel = false;
    let misses = 0;
    async function look() {
      if (!client) return;
      try {
        const coin = await readLaunchedCoin(client, id);
        if (cancel) return;
        if (coin) {
          setLive(coin);
          setPhase("wait");
          return;
        }
        misses += 1;
        if (misses >= 4) setPhase("missing");
      } catch {
        if (!cancel && misses >= 4) setPhase("error");
        misses += 1;
      }
    }
    void look();
    const timer = window.setInterval(() => void look(), 4_000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [listed, id, client]);

  const coin = listed ?? live;
  if (coin) {
    return (
      <div className="coin-page">
        <CoinBody coin={coin} trade={<TradePanel coin={coin} initialSide={side} />} />
      </div>
    );
  }
  if (board.status === "loading" || (poolId.test(id) && phase === "wait")) {
    return (
      <div className="state-page">
        <p className="lede">Indexing your coin…</p>
      </div>
    );
  }
  if (board.status === "error" || phase === "error") {
    return (
      <div className="state-page">
        <p className="lede">{board.error ?? "The network request failed. Check the RPC and try again."}</p>
      </div>
    );
  }
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
