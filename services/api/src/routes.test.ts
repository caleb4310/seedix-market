import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candles } from "./chart.ts";
import { cleanSocials } from "@seedix/shared";
import { handleRequest, type Db } from "./routes.ts";

const pool = "11".repeat(32);

class FakeDb implements Db {
  calls: string[] = [];
  async query<T>(sql: string): Promise<{ rows: T[]; rowCount: number | null }> {
    this.calls.push(sql);
    if (sql.includes("FROM coins c") && sql.includes("pool_id = $2")) {
      return {
        rows: [
          {
            pool_id: pool,
            coin: "22".repeat(20),
            pair: "33".repeat(20),
            name: "Example",
            symbol: "EX",
            pair_symbol: "WHYPE",
            mode: 1,
            is_platform: false,
            fee_recipient: "44".repeat(20),
            team_wallet: null,
            launch_time: "1700000000",
            price: "4",
            holders: "1",
            start_mcap: "10",
          },
        ] as T[],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM swaps") && sql.includes("recent")) {
      return {
        rows: [
          { t: "1000", price: "1", volume: "5" },
          { t: "1100", price: "4", volume: "1" },
          { t: "1300", price: "2", volume: "7" },
        ] as T[],
        rowCount: 3,
      };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe("chart", () => {
  it("buckets without rounding the price string", () => {
    const rows = candles(
      [
        { t: 1000, price: "1.5", volume: 5n },
        { t: 1100, price: "4", volume: 1n },
        { t: 1300, price: "2", volume: 7n },
      ],
      300,
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { t: 900, open: "1.5", high: "4", low: "1.5", close: "4", volume: "6" });
    assert.equal(rows[1]?.open, "2");
  });
});

describe("api", () => {
  it("rejects a pool id that is not 32 bytes before querying", async () => {
    const db = new FakeDb();
    const res = await handleRequest(db, "GET", "/api/coins/0xnot-a-pool", new URLSearchParams());
    assert.equal(res.status, 404);
    assert.equal(db.calls.length, 0);
  });

  it("returns a coin and a chart from bound queries", async () => {
    const db = new FakeDb();
    const one = await handleRequest(db, "GET", `/coins/0x${pool}`, new URLSearchParams());
    assert.equal(one.status, 200);
    assert.equal((one.json as { symbol: string }).symbol, "EX");
    assert.equal((one.json as { mode: string }).mode, "kickback");
    const chart = await handleRequest(db, "GET", `/api/coins/0x${pool}/chart`, new URLSearchParams("bucket=5m"));
    assert.equal(chart.status, 200);
    const body = chart.json as { candles: { volume: string }[] };
    assert.equal(body.candles[0]?.volume, "6");
    const bad = await handleRequest(db, "GET", `/coins/0x${pool}/chart`, new URLSearchParams("bucket=1w"));
    assert.equal(bad.status, 400);
    assert.ok(db.calls.every((sql) => !sql.includes(pool)));
  });

  it("filters and sorts the coin list in the query", async () => {
    const db = new FakeDb();
    const res = await handleRequest(db, "GET", "/coins", new URLSearchParams("mode=kickback&sort=holders&q=ex"));
    assert.equal(res.status, 200);
    const sql = db.calls.at(-1) ?? "";
    assert.match(sql, /c\.mode = \$2/);
    assert.match(sql, /ORDER BY holders DESC/);
    assert.match(sql, /ILIKE/);
  });

  it("lists pre-IPO pairs from the registry and drops a bad website", async () => {
    const db = new FakeDb();
    db.query = async <T>(sql: string) => {
      db.calls.push(sql);
      if (sql.includes("FROM pairs") && sql.includes("category =")) {
        return { rows: [{ address: "55".repeat(20), status: 1, category: 2 }] as T[], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
    const pairs = await handleRequest(db, "GET", "/pairs", new URLSearchParams("category=preipo"));
    assert.equal(pairs.status, 200);
    const body = pairs.json as { pairs: { category: string }[] };
    assert.equal(body.pairs[0]?.category, "preipo");
    const cleaned = cleanSocials({
      description: "hello\u202e",
      website: "javascript:alert(1)",
      x: "@seedix_market",
      telegram: "http://t.me/seedix",
    });
    assert.equal(cleaned.description, "hello");
    assert.equal(cleaned.website, null);
    assert.equal(cleaned.x, "https://x.com/seedix_market");
    assert.equal(cleaned.telegram, null);
    const posted = await handleRequest(db, "POST", "/metadata", new URLSearchParams(), {
      body: { description: "A coin", website: "https://seedix.example/coin", x: "seedix" },
    });
    assert.equal((posted.json as { website: string }).website, "https://seedix.example/coin");
    assert.equal((posted.json as { x: string }).x, "https://x.com/seedix");
  });
});
