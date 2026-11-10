"use client";

import { useEffect, useState } from "react";
import { apiUrl, getChart, type Candle } from "@/lib/api";

type View = "candles" | "bars";

function priceNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function barShare(volume: string, max: bigint): number {
  let value = 0n;
  try {
    value = BigInt(volume);
  } catch {
    return 0;
  }
  if (max <= 0n || value <= 0n) return 0;
  return Number((value * 1000n) / max) / 1000;
}

export function Chart({ poolId }: { poolId?: string }) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [bucket, setBucket] = useState<"5m" | "1h" | "1d">("5m");
  const [view, setView] = useState<View>("candles");
  useEffect(() => {
    if (!apiUrl || !poolId) return;
    let cancel = false;
    getChart(poolId, bucket)
      .then((body) => {
        if (!cancel) setCandles(body.candles);
      })
      .catch(() => {
        if (!cancel) setCandles([]);
      });
    return () => {
      cancel = true;
    };
  }, [poolId, bucket]);
  if (!apiUrl || !poolId) return null;
  const rows = candles ?? [];
  const highs = rows.map((row) => priceNum(row.high));
  const lows = rows.map((row) => priceNum(row.low));
  const min = lows.length > 0 ? Math.min(...lows) : 0;
  const max = highs.length > 0 ? Math.max(...highs) : 0;
  const span = max - min || 1;
  const maxVol = rows.reduce((peak, row) => {
    try {
      const value = BigInt(row.volume);
      return value > peak ? value : peak;
    } catch {
      return peak;
    }
  }, 0n);
  const width = 240;
  const height = 96;
  const slot = rows.length > 0 ? width / rows.length : width;
  const yOf = (value: number) => 8 + ((max - value) / span) * (height - 16);
  return (
    <div className="chart-block">
      <div className="chart-tabs">
        <div role="tablist" aria-label="Chart range">
          {(["5m", "1h", "1d"] as const).map((item) => (
            <button key={item} type="button" className="text-link" aria-pressed={bucket === item} onClick={() => setBucket(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="seg" role="tablist" aria-label="Chart style">
          <button type="button" role="tab" aria-selected={view === "candles"} data-on={view === "candles"} onClick={() => setView("candles")}>
            Candles
          </button>
          <button type="button" role="tab" aria-selected={view === "bars"} data-on={view === "bars"} onClick={() => setView("bars")}>
            Bars
          </button>
        </div>
      </div>
      {rows.length > 0 ? (
        <svg className="chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={view === "candles" ? "Price candles" : "Volume bars"}>
          {rows.map((row, index) => {
            const x = index * slot;
            if (view === "bars") {
              const h = barShare(row.volume, maxVol) * (height - 8);
              return <rect key={row.t} x={x + 1} y={height - h} width={Math.max(slot - 2, 1)} height={h} className="vol-bar" />;
            }
            const open = priceNum(row.open);
            const close = priceNum(row.close);
            const high = priceNum(row.high);
            const low = priceNum(row.low);
            const up = close >= open;
            const bodyY = yOf(Math.max(open, close));
            const bodyH = Math.max(Math.abs(yOf(open) - yOf(close)), 1);
            return (
              <g key={row.t} className={up ? "candle-up" : "candle-down"}>
                <line x1={x + slot / 2} x2={x + slot / 2} y1={yOf(high)} y2={yOf(low)} />
                <rect x={x + 1} y={bodyY} width={Math.max(slot - 2, 1)} height={bodyH} />
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="lede">{candles ? "No trades in this range yet." : "Loading the chart."}</p>
      )}
    </div>
  );
}
