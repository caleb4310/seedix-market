"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { isAddress } from "viem";
import { cleanSocials } from "@seedix/shared";
import { erc20Abi, launcherAbi, metadataAbi } from "@/lib/abi";
import { apiUrl } from "@/lib/api";
import { elysiumTestnet } from "@/lib/chain";
import { modeLabel, type Mode } from "@/lib/coin";
import { coinMetadataAddress, feeWallet, sameAddress } from "@/lib/deployment";
import { buildLaunchParams } from "@/lib/launch";
import { launchSuccess } from "@/lib/launchSuccess";
import { launchedCoin, tokenDecimals } from "@/lib/onchain";
import { parseTokenAmount } from "@/lib/amounts";
import { DEAD } from "@/lib/protocol";
import { loadPairs, pairTabLabel, withChainSymbols, type ListedPair, type PairCategory } from "@/lib/registry";
import { launcherAddress } from "@/lib/trade";
import { useContractTx } from "@/lib/useTx";
import { LaunchPreview } from "@/components/LaunchPreview";
import type { CoinFace } from "@/components/CoinFace";
import { TxStatus } from "@/components/TxStatus";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Tabs";
import { WalletButton } from "@/components/WalletButton";

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

const CID = /^[0-9A-Za-z]{10,128}$/;

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
  const [image, setImage] = useState<string | null>(null);
  const [openPreview, setOpenPreview] = useState(true);
  const [poolId, setPoolId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const frame = useRef(0);
  const start = useRef(0);
  const sending = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const tx = useContractTx();
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: elysiumTestnet.id });

  useEffect(() => {
    let cancel = false;
    loadPairs()
      .then((rows) =>
        withChainSymbols(rows, async (token) => {
          if (!client) return "";
          const symbol = await client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" });
          return typeof symbol === "string" ? symbol : "";
        }),
      )
      .then((rows) => {
        if (!cancel) setPairs(rows);
      })
      .catch(() => {
        if (!cancel) setPairs([]);
      });
    return () => {
      cancel = true;
    };
  }, [client]);

  const listed = pairs.filter((pair) => (source === "any" ? false : pair.category === source));
  const selected = listed.find((pair) => pair.address === pairId) ?? listed[0];
  const unverified = source === "any";
  const addressOk = isAddress(pasted.trim());
  const pairAddress = (unverified ? (addressOk ? pasted.trim() : "") : selected?.address ?? "") as `0x${string}` | "";
  const statusOf = useReadContract({
    address: launcherAddress || undefined,
    abi: launcherAbi,
    functionName: "statusOf",
    args: pairAddress ? [pairAddress] : undefined,
    query: { enabled: Boolean(launcherAddress && pairAddress) },
  });
  const pairAllowed = useReadContract({
    address: launcherAddress || undefined,
    abi: launcherAbi,
    functionName: "pairAllowed",
    args: pairAddress ? [pairAddress] : undefined,
    query: { enabled: Boolean(launcherAddress && pairAddress && statusOf.isError) },
  });
  const chainVetted = statusOf.data !== undefined ? Number(statusOf.data) === 1 : Boolean(pairAllowed.data);
  const vetted = (!unverified && selected?.status === 1) || chainVetted;
  const socials = cleanSocials({ description, website, x: xHandle, telegram });
  const nameBytes = byteLen(name.trim());
  const tickerBytes = byteLen(ticker.trim());
  const burn = mode === "burn";
  const pairOk = burn || (unverified ? addressOk : Boolean(selected));
  const teamOk = Number.isInteger(team) && team >= 0 && team <= 5;
  const ready =
    Boolean(address) &&
    name.trim().length > 0 &&
    nameBytes <= 32 &&
    ticker.trim().length > 0 &&
    tickerBytes <= 8 &&
    teamOk &&
    mcap >= 1000 &&
    pairOk &&
    (!unverified || ack) &&
    (mode !== "kickback" || vetted) &&
    Boolean(launcherAddress);

  const pairSymbol = unverified ? "" : selected?.symbol ?? "";
  const blockReason = !address
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
      startMcap: mcap,
      mcapUsd: selected?.usd != null ? mcap * selected.usd : null,
      startMcapUsd: selected?.usd != null ? mcap * selected.usd : null,
      description: socials.description,
      website: socials.website,
      x: socials.x,
      telegram: socials.telegram,
      unverified,
    }),
    [name, ticker, image, pairSymbol, selected, unverified, mode, mcap, socials],
  );

  const busy = tx.state.status === "awaiting_signature" || tx.state.status === "pending";

  function press() {
    if (busy || !ready) return;
    start.current = performance.now();
    const step = (t: number) => {
      const next = Math.min(1, (t - start.current) / 900);
      setHolding(next);
      if (next >= 1) {
        setHolding(1);
        void launch();
        return;
      }
      frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
  }
  function release() {
    cancelAnimationFrame(frame.current);
    if (!busy && tx.state.status !== "confirmed") setHolding(0);
  }

  function resetLaunch() {
    setName("");
    setTicker("");
    setPasted("");
    setAck(false);
    setMode("keep");
    setTeam(0);
    setMcap(20000);
    setDescription("");
    setWebsite("");
    setXHandle("");
    setTelegram("");
    setImage(null);
    setHolding(0);
    setNote("");
  }

  async function launch() {
    if (sending.current) return;
    sending.current = true;
    try {
      await runLaunch();
    } finally {
      sending.current = false;
    }
  }

  async function runLaunch() {
    if (!address || (!burn && !pairAddress) || !launcherAddress) {
      setNote("Connect a wallet to launch.");
      setHolding(0);
      return;
    }
    const feeRecipient = (recipient.trim() || address) as `0x${string}`;
    if (!isAddress(feeRecipient) || sameAddress(feeRecipient, feeWallet) || sameAddress(feeRecipient, DEAD)) {
      setNote("The fee recipient cannot be the fee wallet or the dead address.");
      setHolding(0);
      return;
    }
    setNote("");
    setPoolId(null);
    let startMcapInPair: bigint;
    try {
      startMcapInPair = parseTokenAmount(String(mcap), 18);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Enter a starting market cap.");
      setHolding(0);
      return;
    }
    let params;
    try {
      params = buildLaunchParams({
        name,
        symbol: ticker,
        pair: (burn ? "0x0000000000000000000000000000000000000000" : pairAddress) as `0x${string}`,
        mode,
        feeRecipient,
        teamPercent: team,
        connected: address,
        startMcapInPair,
      });
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Check the launch form.");
      setHolding(0);
      return;
    }
    const receipt = await tx.send([
      {
        action: "Launch",
        address: launcherAddress,
        abi: launcherAbi,
        functionName: "launch",
        args: [params],
      },
    ]);
    if (!receipt) {
      setHolding(0);
      return;
    }
    const launched = launchedCoin(receipt);
    if (!launched) {
      setNote("The launch was mined, but the coin address was not in the receipt.");
      return;
    }
    setPoolId(launched.poolId);
    const success = launchSuccess(launched.poolId);
    if (apiUrl && image?.startsWith(`${apiUrl}/logos/`)) {
      const url = image.slice(apiUrl.length);
      void fetch(`${apiUrl}/logos/attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poolId: launched.poolId, url }),
      });
    }
    if (success) {
      window.setTimeout(() => {
        resetLaunch();
        router.push(success.href);
      }, 900);
    }
    // The image input is a local preview (`blob:`). It is not uploaded and it is not pinned.
    // CoinMetadata accepts a CID of letters and digits only, which is what a raw CIDv0 or CIDv1
    // looks like. This form never sends `ipfs://`. A description that is itself that CID is pinned.
    const cid = (socials.description ?? "").trim();
    if (coinMetadataAddress && CID.test(cid)) {
      await tx.send([
        {
          action: "Pin metadata",
          address: coinMetadataAddress,
          abi: metadataAbi,
          functionName: "pin",
          args: [launched.poolId, cid],
        },
      ]);
    }
  }

  const preview = <LaunchPreview face={face} />;
  const status = note && tx.state.status === "idle" ? { status: "failed" as const, message: note } : tx.state;

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
              if (!apiUrl) {
                setImage(URL.createObjectURL(file));
                return;
              }
              void file.arrayBuffer().then(async (buf) => {
                const response = await fetch(`${apiUrl}/logos`, { method: "POST", body: buf });
                if (!response.ok) {
                  setNote("Use a PNG, JPEG, or WEBP under 512kb.");
                  return;
                }
                const body = (await response.json()) as { url?: string };
                if (body.url) setImage(`${apiUrl}${body.url}`);
              });
            }}
          />
          <button className="file-btn" type="button" onClick={() => fileRef.current?.click()}>
            {image ? <img src={image} alt="" /> : <span className="mark">+</span>}
            <span>{image ? "Replace image" : "Choose a square image"}</span>
          </button>
        </div>
        <div>
          <span className="lbl">Backing token</span>
          {burn ? (
            <p className="note stack-top">Burn has no backing token. The coin trades against HYPE, and fees buy the coin back and burn it.</p>
          ) : (
            <>
          <Tabs label="Backing source" size="sm" value={source} onChange={setSource} options={sources} />
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
                options={listed.map((pair) => ({ id: pair.address, label: pairTabLabel(pair) }))}
              />
            </div>
          )}
            </>
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
            <Field label="Starting market cap · HYPE">
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
          data-done={tx.state.status === "confirmed"}
          aria-describedby="hold-help"
          disabled={(!ready && tx.state.status !== "confirmed") || busy}
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
          <span className="hold-label">{busy ? "Confirm in your wallet" : ready ? "Hold to launch" : blockReason}</span>
        </button>
        <p id="hold-help" className="note">Hold the button, or hold Enter or Space, until it fills. That sends the launch.</p>
        {chainId !== undefined && address && chainId !== elysiumTestnet.id ? <WalletButton /> : null}
        <TxStatus state={status} />
        {launchSuccess(poolId) ? (
          <div className="launch-success" role="dialog" aria-label="Coin launched">
            <p className="kicker">Launched</p>
            <h2>Your coin is live</h2>
            <p className="lede">It trades against HYPE. Opening the coin page.</p>
            <Link className="btn" href={launchSuccess(poolId)!.href}>
              Open the new coin
            </Link>
          </div>
        ) : null}
      </form>
      <aside className="preview-side">{preview}</aside>
    </div>
  );
}
