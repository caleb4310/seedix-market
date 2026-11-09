"use client";

import { useRef, useState } from "react";
import { modeLabel, type Mode } from "@/lib/mock";

const modes: { id: Mode; body: string }[] = [
  { id: "keep", body: "You claim both sides of the hook fee." },
  { id: "kickback", body: "Holders share the pair side. You keep the coin side." },
  { id: "burn", body: "The pair side buys the coin back. The coin side is burned." },
];

export function LaunchForm() {
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [pair, setPair] = useState("WHYPE");
  const [mode, setMode] = useState<Mode>("keep");
  const [team, setTeam] = useState(0);
  const [mcap, setMcap] = useState(20000);
  const [holding, setHolding] = useState(0);
  const [done, setDone] = useState(false);
  const frame = useRef(0);
  const start = useRef(0);

  function press() {
    if (done || name.trim().length === 0 || ticker.trim().length === 0) return;
    start.current = performance.now();
    const step = (t: number) => {
      const next = Math.min(1, (t - start.current) / 900);
      setHolding(next);
      if (next >= 1) setDone(true);
      else frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }
  function release() {
    cancelAnimationFrame(frame.current);
    if (!done) setHolding(0);
  }

  return (
    <form className="form" onSubmit={(e) => e.preventDefault()}>
      <div>
        <p className="kicker">New coin</p>
        <h1>Launch</h1>
        <p className="lede">Name, ticker, image, pair, and where the fees go. The rest has a sensible default.</p>
      </div>
      <div className="grid-2">
        <label>
          <span className="lbl">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Harbor" />
        </label>
        <label>
          <span className="lbl">Ticker</span>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 8))} placeholder="HARB" />
        </label>
      </div>
      <label>
        <span className="lbl">Image</span>
        <input className="drop" type="file" accept="image/png,image/jpeg,image/webp" />
      </label>
      <label>
        <span className="lbl">Pair token</span>
        <select value={pair} onChange={(e) => setPair(e.target.value)}>
          {["WHYPE", "USDC", "wNVDAx", "wSPYx", "wQQQx", "wMUx", "wSKHYx"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <div className="modes">
        {modes.map((item) => (
          <button key={item.id} type="button" className="mode-opt" data-on={mode === item.id} onClick={() => setMode(item.id)}>
            <span className="radio" />
            <span>
              <strong>{modeLabel(item.id)}</strong>
              <p>{item.body}</p>
            </span>
          </button>
        ))}
      </div>
      <details className="advanced">
        <summary>Advanced · team supply and starting cap</summary>
        <div className="advanced-body">
          <label>
            <span className="lbl">Team supply {team}%</span>
            <input type="number" min={0} max={5} value={team} onChange={(e) => setTeam(Number(e.target.value))} />
          </label>
          <label>
            <span className="lbl">Starting market cap (USD)</span>
            <input type="number" min={1000} value={mcap} onChange={(e) => setMcap(Number(e.target.value))} />
          </label>
          <button className="ghost" type="button" onClick={() => setMcap(20000)}>
            Reset to $20k
          </button>
        </div>
      </details>
      <button
        className="hold"
        type="button"
        data-done={done}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
      >
        <span className="hold-fill" style={{ width: `${holding * 100}%` }} />
        <span style={{ position: "relative" }}>
          {done ? "Ready to sign · testnet launch is wired next" : "Hold to launch"}
        </span>
      </button>
    </form>
  );
}
