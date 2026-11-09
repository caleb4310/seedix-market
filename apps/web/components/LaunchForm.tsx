"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { cleanSocials } from "@seedix/shared";
import { modeLabel, type Mode } from "@/lib/coin";
import { loadPairs, type ListedPair, type PairCategory } from "@/lib/registry";
import { LaunchPreview } from "@/components/LaunchPreview";
import type { CoinFace } from "@/components/CoinFace";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";

const modes: { id: Mode; body: string }[] = [
  { id: "keep", body: "You claim both sides of the hook fee." },
  { id: "kickback", body: "Holders share the pair side. You keep the coin side." },
  { id: "burn", body: "The pair side buys the coin back. The coin side is burned." },
];

const sources: { id: PairCategory | "any"; label: string }[] = [
  { id: "stock", label: "Stocks" },
  { id: "preipo", label: "Pre-IPO" },
  { id: "any", label: "Any coin" },
];

function byteLen(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function LaunchForm() {
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [source, setSource] = useState<PairCategory | "any">("stock");
  const [pairs, setPairs] = useState<ListedPair[]>([]);
  const [pairId, setPairId] = useState("");
  const [pasted, setPasted] = useState("");
  const [ack, setAck] = useState(false);
  const [mode, setMode] = useState<Mode>("keep");
  const [team, setTeam] = useState(0);
  const [mcap, setMcap] = useState(20000);
  const [recipient, setRecipient] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [telegram, setTelegram] = useState("");
  const [holding, setHolding] = useState(0);
  const [done, setDone] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [openPreview, setOpenPreview] = useState(true);
  const frame = useRef(0);
  const start = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { isConnected } = useAccount();

  useEffect(() => {
    let cancel = false;
    loadPairs()
      .then((rows) => {
        if (!cancel) setPairs(rows);
      })
      .catch(() => {
        if (!cancel) setPairs([]);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const listed = pairs.filter((pair) => (source === "any" ? false : pair.category === source));
  const selected = listed.find((pair) => pair.address === pairId) ?? listed[0];
  const unverified = source === "any";
  const vetted = !unverified && selected?.status === 1;
  const socials = cleanSocials({ description, website, x: xHandle, telegram });
  const nameBytes = byteLen(name.trim());
  const tickerBytes = byteLen(ticker.trim());
  const addressOk = /^0x[0-9a-fA-F]{40}$/.test(pasted.trim());
  const pairOk = unverified ? addressOk : Boolean(selected);
  const teamOk = team >= 0 && team <= 5;
  const ready =
    isConnected &&
    name.trim().length > 0 &&
    nameBytes <= 32 &&
    ticker.trim().length > 0 &&
    tickerBytes <= 8 &&
    teamOk &&
    mcap >= 1000 &&
    pairOk &&
    (!unverified || ack) &&
    (mode !== "kickback" || vetted);

  const pairSymbol = unverified ? "" : selected?.symbol ?? "";
  const blockReason = !isConnected
    ? "Connect your wallet"
    : name.trim().length === 0
      ? "Add a name"
      : nameBytes > 32
        ? "Shorten the name"
        : ticker.trim().length === 0
          ? "Add a ticker"
          : tickerBytes > 8
            ? "Shorten the ticker"
            : !pairOk
              ? unverified
                ? "Paste a token address"
                : source === "preipo"
                  ? "No pre-IPO pair yet"
                  : "Pick a pair"
              : unverified && !ack
                ? "Confirm the unverified token"
                : mode === "kickback" && !vetted
                  ? "Kickback needs a vetted pair"
                  : mcap < 1000
                    ? "Raise the starting cap"
                    : "";

  const face: CoinFace = useMemo(
    () => ({
      name,
      ticker,
      image,
      pairSymbol,
      pairLogo: selected?.logo ?? null,
      pairTest: selected?.test,
      category: unverified ? "crypto" : selected?.category ?? null,
      mode,
      mcap,
      mcapUsd: selected?.usd != null ? mcap * selected.usd : null,
      description: socials.description,
      website: socials.website,
      x: socials.x,
      telegram: socials.telegram,
      unverified,
    }),
    [name, ticker, image, pairSymbol, selected, unverified, mode, mcap, socials],
  );

  function press() {
    if (done || !ready) return;
    start.current = performance.now();
    const step = (t: number) => {
      const next = Math.min(1, (t - start.current) / 900);
      setHolding(next);
      if (next >= 1) {
        setDone(true);
        toast("Ready to sign. The wallet transaction is wired separately.");
      } else frame.current = requestAnimationFrame(step);
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

  const preview = <LaunchPreview face={face} />;

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
              setImage(URL.createObjectURL(file));
            }}
          />
          <button className="file-btn" type="button" onClick={() => fileRef.current?.click()}>
            {image ? <img src={image} alt="" /> : <span className="mark">+</span>}
            <span>{image ? "Replace image" : "Choose a square image"}</span>
          </button>
        </div>
        <div>
          <span className="lbl">Pair token</span>
          <Tabs label="Pair source" size="sm" value={source} onChange={setSource} options={sources} />
          {source === "any" ? (
            <div className="stack-top">
              <Field label="Token address">
                <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="0x" spellCheck={false} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I understand this is an unverified token. Kickback is not available.</span>
              </label>
            </div>
          ) : listed.length === 0 ? (
            <p className="note stack-top">
              {source === "preipo" ? "No pre-IPO tokens on Elysium yet." : "No stock pairs listed yet."}
            </p>
          ) : (
            <div className="stack-top">
              <Tabs
                label="Listed pair"
                size="sm"
                value={selected?.address ?? ""}
                onChange={setPairId}
                options={listed.map((pair) => ({ id: pair.address, label: pair.symbol }))}
              />
            </div>
          )}
        </div>
        <div className="modes" role="radiogroup" aria-label="Fee mode">
          {modes.map((item) => {
            const blocked = item.id === "kickback" && !vetted;
            return (
              <button
                key={item.id}
                type="button"
                className="mode-opt"
                role="radio"
                aria-checked={mode === item.id}
                data-on={mode === item.id}
                disabled={blocked}
                onClick={() => setMode(item.id)}
              >
                <span className="radio" />
                <span>
                  <strong>{modeLabel(item.id)}</strong>
                  <p>{blocked ? "Vetted pairs only." : item.body}</p>
                </span>
              </button>
            );
          })}
        </div>
        <Field label="Description · optional, 280 characters">
          <textarea value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Website · optional, https">
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </Field>
          <Field label="X · optional">
            <input value={xHandle} onChange={(e) => setXHandle(e.target.value)} placeholder="@handle" />
          </Field>
        </div>
        <Field label="Telegram · optional, https">
          <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="https://t.me/" />
        </Field>
        <details className="preview-fold" open={openPreview} onToggle={(e) => setOpenPreview(e.currentTarget.open)}>
          <summary>Preview</summary>
          {preview}
        </details>
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
            <Field label={`Starting market cap · ${pairSymbol || "pair"}`}>
              <input type="number" min={1000} value={mcap} onChange={(e) => setMcap(Number(e.target.value))} />
            </Field>
            <Button variant="ghost" type="button" onClick={() => setMcap(20000)}>
              Reset to 20,000 {pairSymbol || "pair"}
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
          <span className="hold-label">{done ? "Ready to sign" : ready ? "Hold to launch" : blockReason}</span>
        </button>
        <p id="hold-help" className="note">
          Hold the button, or hold Enter or Space. Signing stays with the wallet flow.
        </p>
        {done ? (
          <Button variant="ghost" type="button" onClick={reset}>
            Reset
          </Button>
        ) : null}
      </form>
      <aside className="preview-side">{preview}</aside>
    </div>
  );
}
