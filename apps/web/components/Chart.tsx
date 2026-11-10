"use client";

import { useEffect, useState } from "react";
import { apiUrl, getChart, type Candle } from "@/lib/api";

function line(candles: Candle[]): string {
  const values = candles.map((candle) => Number(candle.close)).filter((value) => Number.isFinite(value));
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 240;
  const height = 72;
  const yOf = (value: number) => height - 4 - ((value - min) / span) * (height - 8);
  if (values.length === 1) {
    const y = yOf(values[0] ?? 0).toFixed(2);
    return `M0 ${y} L${width} ${y}`;
  }
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${yOf(value).toFixed(2)}`;
    })
    .join(" ");
}

export function Chart({ poolId }: { poolId?: string }) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [bucket, setBucket] = useState<"5m" | "1h" | "1d">("5m");
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
  const path = candles ? line(candles) : "";
  return (
    <div className="chart-block">
      <div className="chart-tabs" role="tablist" aria-label="Chart range">
        {(["5m", "1h", "1d"] as const).map((item) => (
          <button key={item} type="button" className="text-link" aria-pressed={bucket === item} onClick={() => setBucket(item)}>
            {item}
          </button>
        ))}
      </div>
      {path ? (
        <svg className="chart" viewBox="0 0 240 72" preserveAspectRatio="none" role="img" aria-label="Price">
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : (
        <p className="lede">{candles ? "No trades in this range yet." : "Loading the chart."}</p>
      )}
    </div>
  );
}
