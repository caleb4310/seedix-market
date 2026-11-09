"use client";

import { useRef, useState } from "react";
import { modeLabel, type Mode } from "@/lib/mock";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";

const modes: { id: Mode; body: string }[] = [
  { id: "keep", body: "You claim both sides of the hook fee." },
  { id: "kickback", body: "Holders share the pair side. You keep the coin side." },
  { id: "burn", body: "The pair side buys the coin back. The coin side is burned." },
];

const pairs = ["WHYPE", "USDC", "wNVDAx", "wSPYx", "wQQQx", "wMUx", "wSKHYx"];

function byteLen(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function LaunchForm() {
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [pair, setPair] = useState("WHYPE");
  const [mode, setMode] = useState<Mode>("keep");
  const [team, setTeam] = useState(0);
  const [mcap, setMcap] = useState(20000);
  const [recipient, setRecipient] = useState("");
  const [holding, setHolding] = useState(0);
  const [done, setDone] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const frame = useRef(0);
  const start = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const nameBytes = byteLen(name.trim());
  const tickerBytes = byteLen(ticker.trim());
  const teamOk = team >= 0 && team <= 5;
  const ready =
    name.trim().length > 0 &&
    nameBytes <= 32 &&
    ticker.trim().length > 0 &&
    tickerBytes <= 8 &&
    teamOk &&
    mcap >= 1000;

  function press() {
    if (done || !ready) return;
    start.current = performance.now();
    const step = (t: number) => {
      const next = Math.min(1, (t - start.current) / 900);
      setHolding(next);
      if (next >= 1) {
        setDone(true);
        toast("Ready to sign. The testnet transaction is the next step.");
      }
      else frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }
  function release() {
    cancelAnimationFrame(frame.current);
    if (!done) setHolding(0);
  }
  function reset() {
    cancelAnimationFrame(frame.current);
    setDone(false);
    setHolding(0);
  }

  return (
    <div className="launch-layout">
    <form className="form" onSubmit={(e) => e.preventDefault()}>
      <div>
        <p className="kicker">New coin</p>
        <h1>Launch</h1>
        <p className="lede">Name, ticker, image, pair, and where the fees go. The rest has a sensible default.</p>
      </div>
      <div className="grid-2">
        <Field label={`Name · ${nameBytes}/32 bytes`}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="North star" />
        </Field>
        <Field label={`Ticker · ${tickerBytes}/8 bytes`}>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 8))}
            placeholder="NSTR"
          />
        </Field>
      </div>
      <div>
        <span className="lbl">Image</span>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            setPreview(url);
          }}
        />
        <button className="file-btn" type="button" onClick={() => fileRef.current?.click()}>
          {preview ? <img src={preview} alt="" /> : <span className="mark">+</span>}
          <span>{preview ? "Replace image" : "Choose a square image"}</span>
        </button>
      </div>
      <div>
        <span className="lbl">Pair token</span>
        <Tabs
          label="Pair token"
          size="sm"
          value={pair}
          onChange={setPair}
          options={pairs.map((item) => ({ id: item, label: item }))}
        />
      </div>
      <div className="modes" role="radiogroup" aria-label="Fee mode">
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            className="mode-opt"
            role="radio"
            aria-checked={mode === item.id}
            data-on={mode === item.id}
            onClick={() => setMode(item.id)}
          >
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
          <Field label="Fee recipient">
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Defaults to the connected wallet"
            />
          </Field>
          <Field label={`Team supply ${team}% · max 5`}>
            <input
              type="number"
              min={0}
              max={5}
              value={team}
              onChange={(e) => setTeam(Math.min(5, Math.max(0, Number(e.target.value) || 0)))}
            />
          </Field>
          <Field label={`Starting market cap · ${pair}`}>
            <input type="number" min={1000} value={mcap} onChange={(e) => setMcap(Number(e.target.value))} />
          </Field>
          <Button variant="ghost" type="button" onClick={() => setMcap(20000)}>
            Reset to 20,000 {pair}
          </Button>
        </div>
      </details>
      <button
        className="hold"
        type="button"
        data-done={done}
        aria-describedby="hold-help"
        disabled={!ready && !done}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (e.repeat) return;
            press();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") release();
        }}
      >
        <span className="hold-fill" style={{ width: `${holding * 100}%` }} />
        <span className="hold-label">
          {done ? "Ready to sign · testnet launch is wired next" : "Hold to launch"}
        </span>
      </button>
      <p id="hold-help" className="note">
        Hold the button, or hold Enter or Space. {done ? "Release does not clear a finished hold." : "Letting go resets it."}
      </p>
      {done ? (
        <Button variant="ghost" type="button" onClick={reset}>
          Reset
        </Button>
      ) : null}
    </form>
    <aside className="card">
      <p className="kicker">What you will sign</p>
      <h2 className="lede">{name.trim() || "New coin"}</h2>
      <dl className="review stack-top">
        <div>
          <dt>Mode</dt>
          <dd>{modeLabel(mode)}</dd>
        </div>
        <div>
          <dt>Pair</dt>
          <dd>{pair}</dd>
        </div>
        <div>
          <dt>Team</dt>
          <dd>{team}%</dd>
        </div>
        <div>
          <dt>Decay</dt>
          <dd>80% to 1% over 10s</dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd>{recipient.trim() || "Connected wallet"}</dd>
        </div>
      </dl>
    </aside>
    </div>
  );
}
