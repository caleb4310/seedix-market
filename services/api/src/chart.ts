export type ChartPoint = { t: number; price: string; volume: bigint };
export type Candle = { t: number; open: string; high: string; low: string; close: string; volume: string };

const buckets: Record<string, number> = { "5m": 300, "1h": 3600, "1d": 86400 };

export function bucketSeconds(name: string): number | null {
  return buckets[name] ?? null;
}

function cmp(a: string, b: string): number {
  const [aw = "0", af = ""] = a.split(".");
  const [bw = "0", bf = ""] = b.split(".");
  const width = Math.max(aw.length, bw.length);
  const left = aw.padStart(width, "0") + af.padEnd(Math.max(af.length, bf.length), "0");
  const right = bw.padStart(width, "0") + bf.padEnd(Math.max(af.length, bf.length), "0");
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

/** Seconds. Millisecond and microsecond stamps are scaled down so a 5m bucket is five minutes. */
export function epochSeconds(t: number): number {
  if (!Number.isFinite(t)) return Number.NaN;
  if (t > 1e14) return t / 1e6;
  if (t > 1e11) return t / 1e3;
  return t;
}

/** OHLC candles. Prices stay decimal strings so a large sqrt price is not rounded. */
export function candles(points: ChartPoint[], bucketSec: number): Candle[] {
  const out: Candle[] = [];
  for (const point of points) {
    const seconds = epochSeconds(point.t);
    if (!Number.isFinite(seconds)) continue;
    const t = Math.floor(seconds / bucketSec) * bucketSec;
    const last = out[out.length - 1];
    if (!last || last.t !== t) {
      out.push({ t, open: point.price, high: point.price, low: point.price, close: point.price, volume: point.volume.toString() });
      continue;
    }
    if (cmp(point.price, last.high) > 0) last.high = point.price;
    if (cmp(point.price, last.low) < 0) last.low = point.price;
    last.close = point.price;
    last.volume = (BigInt(last.volume) + point.volume).toString();
  }
  return out;
}
