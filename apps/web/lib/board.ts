"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { marketCapFromRaw, marketCapUsd } from "./amounts";
import { coinPrice, LAUNCH_SUPPLY, marketCapFromSpot } from "@seedix/shared";
import { apiUrl, coinFromApi, getCoins } from "./api";
import type { Coin, Mode } from "./coin";
import { decimalsAbi, erc20Abi, launcherLegacyAbi } from "./abi";
import type { PublicClient } from "viem";
import { hookAddress, hookConfigAbi, indexerStartBlock, launcherAbi, launcherAddress, stateViewAddress, tokenMetaAbi } from "./trade";

export type Board = {
  status: "loading" | "ready" | "error";
  coins: Coin[];
  error?: string;
};

const slotAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

async function withSpot(client: PublicClient, coins: Coin[]): Promise<Coin[]> {
  if (!stateViewAddress) return coins;
  return Promise.all(
    coins.map(async (coin) => {
      if (!coin.poolId || !coin.tokenAddress || coin.coinIsToken0 === undefined) return coin;
      try {
        const [slot, supply] = await Promise.all([
          client.readContract({ address: stateViewAddress, abi: slotAbi, functionName: "getSlot0", args: [coin.poolId] }),
          client.readContract({ address: coin.tokenAddress, abi: erc20Abi, functionName: "totalSupply" }).catch(() => LAUNCH_SUPPLY),
        ]);
        const sqrt = Array.isArray(slot) ? slot[0] : 0n;
        if (typeof sqrt !== "bigint" || sqrt <= 0n) return coin;
        const text = marketCapFromSpot(
          coinPrice(sqrt, coin.coinIsToken0),
          typeof supply === "bigint" && supply > 0n ? supply : LAUNCH_SUPPLY,
          coin.pairDecimals ?? 18,
        );
        if (!text) return coin;
        const amount = Number(text);
        if (!Number.isFinite(amount)) return coin;
        return { ...coin, mcap: amount, mcapUsd: marketCapUsd(amount, coin.pairUsd) };
      } catch {
        return coin;
      }
    }),
  );
}

const empty: Board = { status: launcherAddress ? "loading" : "ready", coins: [] };

export function useBoard(): Board {
  const client = usePublicClient();
  const [board, setBoard] = useState<Board>(empty);

  useEffect(() => {
    let cancel = false;
    const dev = process.env.NODE_ENV !== "production";

    async function load() {
      if (apiUrl) {
        try {
          const body = await getCoins();
          let coins = body.coins.map((row) => coinFromApi(row, hookAddress || undefined));
          if (client) coins = await withSpot(client, coins);
          if (!cancel) setBoard({ status: "ready", coins });
        } catch {
          if (!cancel) setBoard({ status: "error", coins: [], error: "The coin list is unavailable." });
        }
        return;
      }
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
        const events = [launcherAbi, launcherLegacyAbi].flatMap((abi) => {
          const event = abi.find((item) => item.type === "event" && item.name === "CoinLaunched");
          return event && event.type === "event" ? [event] : [];
        });
        const batches = await Promise.all(
          events.map((event) =>
            client
              .getLogs({
                address: launcherAddress,
                event: event as never,
                fromBlock: indexerStartBlock,
                toBlock: "latest",
              })
              .catch(() => []),
          ),
        );
        const logs = batches.flat() as {
          args: {
            poolId?: `0x${string}`;
            coin?: `0x${string}`;
            pair?: `0x${string}`;
            mode?: number | bigint;
            isPlatform?: boolean;
            feeRecipient?: `0x${string}`;
            startMcap?: bigint | number;
            backing?: `0x${string}`;
          };
        }[];
        const coins: Coin[] = [];
        for (const log of logs) {
          const args = log.args;
          const poolId = args.poolId;
          const token = args.coin;
          const pair = args.pair;
          if (!poolId || !token || !pair) continue;
          const [config, name, symbol, pairSymbol, pairDecimals] = await Promise.all([
            client.readContract({ address: hookAddress, abi: hookConfigAbi, functionName: "config", args: [poolId] }),
            client.readContract({ address: token, abi: tokenMetaAbi, functionName: "name" }),
            client.readContract({ address: token, abi: tokenMetaAbi, functionName: "symbol" }),
            client.readContract({ address: pair, abi: tokenMetaAbi, functionName: "symbol" }),
            client.readContract({ address: pair, abi: decimalsAbi, functionName: "decimals" }).catch(() => 18),
          ]);
          const configRow = config as readonly unknown[];
          const launchTime = Number(configRow[5]);
          const modeN = Number(args.mode);
          const mode: Mode = modeN === 1 ? "kickback" : modeN === 2 ? "burn" : "keep";
          const now = Math.floor(Date.now() / 1000);
          const coinName = typeof name === "string" && name.length > 0 ? name : "Coin";
          const coinSymbol = typeof symbol === "string" && symbol.length > 0 ? symbol : "COIN";
          const pairName = typeof pairSymbol === "string" && pairSymbol.length > 0 ? pairSymbol : "PAIR";
          const rawBacking = args.backing;
          const backing = rawBacking && !/^0x0{40}$/i.test(rawBacking) ? rawBacking : null;
          coins.push({
            id: poolId,
            name: coinName,
            ticker: coinSymbol,
            pair: pairName,
            mode,
            ageSec: Math.max(0, now - launchTime),
            launchTime,
            description: args.isPlatform ? "Platform token." : `${mode} mode, paired with ${pairName}.`,
            recipient: (args.feeRecipient ?? token) as `0x${string}`,
            startMcap: args.startMcap === undefined ? undefined : marketCapFromRaw(BigInt(args.startMcap), Number(pairDecimals)),
            pairDecimals: Number(pairDecimals),
            coinIsToken0: Boolean(configRow[2]),
            tokenAddress: token,
            pairAddress: pair,
            backing,
            hooks: hookAddress,
            poolId,
          });
        }
        coins.reverse();
        const spotted = client ? await withSpot(client, coins) : coins;
        if (!cancel) setBoard({ status: "ready", coins: spotted });
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
