"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Coin, Mode } from "./coin";
import { hookAddress, hookConfigAbi, launcherAbi, launcherAddress, tokenMetaAbi } from "./trade";

export type Board = {
  status: "loading" | "ready" | "error";
  coins: Coin[];
  error?: string;
};

const empty: Board = { status: launcherAddress ? "loading" : "ready", coins: [] };

export function useBoard(): Board {
  const client = usePublicClient();
  const [board, setBoard] = useState<Board>(empty);

  useEffect(() => {
    let cancel = false;
    const dev = process.env.NODE_ENV !== "production";

    async function load() {
      if (!launcherAddress || !hookAddress || !client) {
        if (dev && !launcherAddress) {
          const mock = await import("./mock");
          if (!cancel) setBoard({ status: "ready", coins: mock.coins });
          return;
        }
        if (!cancel) setBoard({ status: "ready", coins: [] });
        return;
      }
      setBoard({ status: "loading", coins: [] });
      try {
        const logs = await client.getLogs({
          address: launcherAddress,
          event: launcherAbi[0],
          fromBlock: 0n,
          toBlock: "latest",
        });
        const coins: Coin[] = [];
        for (const log of logs) {
          const poolId = log.args.poolId;
          const token = log.args.coin;
          const pair = log.args.pair;
          if (!poolId || !token || !pair) continue;
          const [config, name, symbol, pairSymbol] = await Promise.all([
            client.readContract({ address: hookAddress, abi: hookConfigAbi, functionName: "config", args: [poolId] }),
            client.readContract({ address: token, abi: tokenMetaAbi, functionName: "name" }),
            client.readContract({ address: token, abi: tokenMetaAbi, functionName: "symbol" }),
            client.readContract({ address: pair, abi: tokenMetaAbi, functionName: "symbol" }),
          ]);
          const launchTime = Number(config[5]);
          const modeN = Number(log.args.mode);
          const mode: Mode = modeN === 1 ? "kickback" : modeN === 2 ? "burn" : "keep";
          const now = Math.floor(Date.now() / 1000);
          coins.push({
            id: poolId,
            name: name || "Coin",
            ticker: symbol || "COIN",
            pair: pairSymbol || "PAIR",
            mode,
            ageSec: Math.max(0, now - launchTime),
            launchTime,
            description: log.args.isPlatform ? "Platform token." : `${mode} mode, paired with ${pairSymbol}.`,
            recipient: (log.args.feeRecipient ?? token) as `0x${string}`,
            coinIsToken0: Boolean(config[2]),
            tokenAddress: token,
            pairAddress: pair,
            hooks: hookAddress,
            poolId,
          });
        }
        coins.reverse();
        if (!cancel) setBoard({ status: "ready", coins });
      } catch {
        if (!cancel) {
          setBoard({
            status: "error",
            coins: [],
            error: "The network request failed. Check the RPC and try again.",
          });
        }
      }
    }

    void load();
    return () => {
      cancel = true;
    };
  }, [client]);

  return board;
}
