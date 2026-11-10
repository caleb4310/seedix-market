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
import type { Mode } from "@/lib/coin";
import { coinMetadataAddress, executorAddress, explorerAddress, feeWallet, sameAddress } from "@/lib/deployment";
import { buildLaunchParams } from "@/lib/launch";
import { launchSuccess } from "@/lib/launchSuccess";
import { logoAttachPath, logoSrc } from "@/lib/logoUrl";
import { launchedCoin } from "@/lib/onchain";
import { DEAD } from "@/lib/protocol";
import { loadPairs, withChainSymbols, type ListedPair, type PairCategory } from "@/lib/registry";
import { formatUsdCompact, launchCapLabel, startWhypeFromChain, whypeAmount } from "@/lib/startCap";
import { useHypeUsd } from "@/lib/hype";
import { launcherAddress } from "@/lib/trade";
import { useContractTx } from "@/lib/useTx";
import { BackingCombobox } from "@/components/BackingCombobox";
import { LaunchPreview } from "@/components/LaunchPreview";
import type { CoinFace } from "@/components/CoinFace";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { WalletButton } from "@/components/WalletButton";

const modes: { id: Mode; title: string; body: (ticker: string, backing: string) => string }[] = [
  { id: "keep", title: "Keep them", body: () => "Your share of every trading fee is yours to claim." },
  {
    id: "kickback",
    title: "Kick them back",
    body: (_ticker, backing) =>
      `Holders are paid your share of the ${backing || "backing"} side. You keep the coin side. This makes it a Kickback coin.`,
  },
  {
    id: "burn",
    title: "Burn them",
    body: (ticker) =>
      `Your share of every trading fee is routed to buy $${ticker || "TICKER"} back and burn it, trade by trade. You keep the LP fee. This makes it a Burner.`,
  },
];

const sources: { id: PairCategory | "any"; label: string }[] = [
  { id: "stock", label: "Stocks" },
  { id: "preipo", label: "Pre-IPO" },
  { id: "any", label: "Any coin" },
];

const depthAbi = [
  {
    type: "function",
    name: "routeDepth",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const CID = /^[0-9A-Za-z]{10,128}$/;

function byteLen(value: string): number {
  return new TextEncoder().encode(value).length;
}

function badge(pair: ListedPair): string {
  if (pair.status !== 1) return "UNVETTED";
  if (pair.category === "stock") return "VERIFIED STOCK";
  if (pair.category === "preipo") return "PRE-IPO";
  return "CRYPTO";
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
  const [recipient, setRecipient] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [telegram, setTelegram] = useState("");
  const [holding, setHolding] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [poolId, setPoolId] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const frame = useRef(0);
  const start = useRef(0);
  const sending = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toasted = useRef("");
  const router = useRouter();
  const toast = useToast();
  const tx = useContractTx();
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: elysiumTestnet.id });
  const hypeUsd = useHypeUsd();

  useEffect(() => {
    if (tx.state.status === "failed" && tx.state.message && tx.state.message !== toasted.current) {
      toasted.current = tx.state.message;
      toast(tx.state.message, "error");
    }
    if (tx.state.status !== "failed") toasted.current = "";
  }, [tx.state, toast]);

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

  const capRead = useReadContract({
    address: launcherAddress || undefined,
    abi: launcherAbi,
    functionName: "startMcap",
    query: { enabled: Boolean(launcherAddress) },
  });
  const startWei = startWhypeFromChain(typeof capRead.data === "bigint" ? capRead.data : undefined);
  const cap = launchCapLabel(hypeUsd, startWei);

  const listed = pairs.filter((pair) => (source === "any" ? false : pair.category === source && !/^whype$/i.test(pair.symbol)));
  const selected = listed.find((pair) => pair.address === pairId) ?? null;
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
  const depth = useReadContract({
    address: executorAddress || undefined,
    abi: depthAbi,
    functionName: "routeDepth",
    args: pairAddress ? [pairAddress] : undefined,
    query: { enabled: Boolean(executorAddress && pairAddress && mode !== "burn") },
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
    pairOk &&
    (!unverified || ack) &&
    (mode !== "kickback" || vetted) &&
    Boolean(launcherAddress);

  const backingName = burn ? "Burn" : unverified ? "Any coin" : selected?.symbol || "Backing";
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
                  : "Pick a stock"
              : unverified && !ack
                ? "Confirm the unverified token"
                : mode === "kickback" && !vetted
                  ? "Kickback needs a vetted backing token"
                  : "";

  const face: CoinFace = useMemo(
    () => ({
      name,
      ticker,
      image,
      pairSymbol: backingName,
      pairLogo: selected?.logo ?? null,
      pairTest: selected?.test,
      category: burn ? null : unverified ? "crypto" : selected?.category ?? null,
      mode,
      description: socials.description,
      website: socials.website,
      x: socials.x,
      telegram: socials.telegram,
      unverified,
    }),
    [name, ticker, image, backingName, selected, unverified, burn, mode, socials],
  );

  const busy = tx.state.status === "awaiting_signature" || tx.state.status === "pending";

  function press() {
    if (busy || !ready) {
      if (blockReason) toast(blockReason, "error");
      return;
    }
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
    setDescription("");
    setWebsite("");
    setXHandle("");
    setTelegram("");
    setImage(null);
    setHolding(0);
    setReview(false);
    setPairId("");
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
      toast("Connect a wallet to launch.", "error");
      setHolding(0);
      return;
    }
    const feeRecipient = (recipient.trim() || address) as `0x${string}`;
    if (!isAddress(feeRecipient) || sameAddress(feeRecipient, feeWallet) || sameAddress(feeRecipient, DEAD)) {
      toast("The fee recipient cannot be the fee wallet or the dead address.", "error");
      setHolding(0);
      return;
    }
    setPoolId(null);
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
        startMcapInPair: startWei,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Check the launch form.", "error");
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
      toast("The launch was mined, but the coin address was not in the receipt.", "error");
      return;
    }
    setPoolId(launched.poolId);
    const success = launchSuccess(launched.poolId);
    const path = image ? logoAttachPath(image, apiUrl) : null;
    if (apiUrl && path) {
      void fetch(`${apiUrl}/logos/attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poolId: launched.poolId, url: path }),
      });
    }
    if (success) {
      window.setTimeout(() => {
        resetLaunch();
        router.push(success.href);
      }, 900);
    }
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

  const preview = <LaunchPreview face={face} cap={cap} backing={backingName} />;
  const liquidity =
    typeof depth.data === "bigint" && depth.data > 0n
      ? hypeUsd != null
        ? formatUsdCompact(whypeAmount(depth.data) * hypeUsd)
        : "USD price unavailable"
      : "—";

  return (
    <div className="launch-layout">
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <div>
          <p className="kicker">Launching on Elysium testnet</p>
          <h1>Create your coin</h1>
          <p className="lede">Nothing touches the chain until you launch. Four things are permanent: the name, the ticker, the backing, and where the fees go.</p>
        </div>
        <section className="permanent">
          <header className="permanent-head">
            <span>Permanent</span>
            <span>4 things</span>
            <span>Never changeable</span>
          </header>
          <Field label={`Name · ${nameBytes}/32 bytes`}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="North star" />
          </Field>
          <div className="pair-row">
            <Field label={`Ticker · ${tickerBytes}/8 bytes`}>
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 8))}
                placeholder="NSTR"
              />
            </Field>
            <div>
              <span className="lbl">Paired with</span>
              {burn ? (
                <p className="note">Burn has no backing token. The coin trades against HYPE, and fees buy the coin back and burn it.</p>
              ) : (
                <Tabs
                  label="Backing source"
                  size="sm"
                  value={source}
                  onChange={(next) => {
                    setSource(next);
                    setPairId("");
                  }}
                  options={sources}
                />
              )}
            </div>
          </div>
          {burn ? null : source === "any" ? (
            <div className="stack-top">
              <Field label="Token address">
                <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="0x" spellCheck={false} />
              </Field>
              <p className="unverified">Unverified token</p>
              <label className="check">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I understand this is an unverified token. Kickback is not available.</span>
              </label>
            </div>
          ) : (
            <div className="stack-top">
              <BackingCombobox
                pairs={listed}
                value={pairId}
                onChange={setPairId}
                empty={source === "preipo" ? "No pre-IPO tokens on Elysium yet." : "No stock pairs listed yet."}
              />
              {selected ? (
                <article className="pair-details">
                  <header>
                    <p>
                      You can pair with <strong>{selected.symbol}</strong>.
                    </p>
                    <span className="tag">{badge(selected)}</span>
                  </header>
                  <dl>
                    <div>
                      <dt>token</dt>
                      <dd>{selected.symbol}</dd>
                    </div>
                    <div>
                      <dt>name</dt>
                      <dd>{selected.name || selected.symbol}</dd>
                    </div>
                    <div>
                      <dt>price</dt>
                      <dd>{selected.usd != null ? formatUsdCompact(selected.usd) : "USD price unavailable"}</dd>
                    </div>
                    <div>
                      <dt>liquidity</dt>
                      <dd>{liquidity}</dd>
                    </div>
                  </dl>
                  <p className="addr-row">
                    <span>{selected.address}</span>
                    <button
                      type="button"
                      className="text-link copy-btn"
                      onClick={() => {
                        void navigator.clipboard.writeText(selected.address).then(() => toast("Address copied."));
                      }}
                    >
                      Copy
                    </button>
                    <a href={explorerAddress(selected.address)} target="_blank" rel="noopener noreferrer">
                      Explorer
                    </a>
                  </p>
                </article>
              ) : null}
            </div>
          )}
        </section>
        <div>
          <span className="lbl">Trading fees</span>
          <div className="fee-grid" role="radiogroup" aria-label="Fee mode">
            {modes.map((item) => {
              const blocked = item.id === "kickback" && !vetted && (Boolean(selected) || unverified);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="mode-opt"
                  role="radio"
                  aria-checked={mode === item.id}
                  data-on={mode === item.id}
                  disabled={false}
                  onClick={() => setMode(item.id)}
                >
                  <span className="radio" />
                  <span>
                    <strong>{item.title}</strong>
                    <p>{blocked ? "Vetted backing tokens only." : item.body(ticker.trim(), selected?.symbol ?? "")}</p>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <section className="poster">
          <span className="lbl">The poster</span>
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
                  toast("Use a PNG, JPEG, or WEBP under 512kb.", "error");
                  return;
                }
                const body = (await response.json()) as { url?: string };
                const next = logoSrc(body.url);
                if (!next) {
                  toast("The logo could not be stored.", "error");
                  return;
                }
                setImage(next);
              });
            }}
          />
          <button className="drop" type="button" onClick={() => fileRef.current?.click()}>
            {image ? <img src={logoSrc(image) ?? image} alt="" /> : <span className="stripes">Drop image</span>}
          </button>
          <Field label="One line about it">
            <input value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} placeholder="One line about it" />
          </Field>
          <div className="grid-2">
            <Field label="Website">
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
            </Field>
            <Field label="X">
              <input value={xHandle} onChange={(e) => setXHandle(e.target.value)} placeholder="x.com/" />
            </Field>
          </div>
          <Field label="Telegram">
            <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="https://t.me/" />
          </Field>
        </section>
        <details className="preview-fold">
          <summary>Live preview</summary>
          {preview}
        </details>
        <details className="advanced">
          <summary>Advanced · team supply</summary>
          <div className="advanced-body">
            <Field label="Fee recipient">
              <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Defaults to the connected wallet" />
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
          </div>
        </details>
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            if (blockReason && blockReason !== "Connect your wallet") toast(blockReason, "error");
            setReview(true);
          }}
        >
          Read it back →
        </Button>
        {review ? (
          <section className="readback" aria-label="Read it back">
            <p>
              <strong>{name.trim() || "Name"}</strong> ${ticker.trim() || "TICKER"} · {backingName} · {modes.find((item) => item.id === mode)?.title} · {cap}
            </p>
            <p className="note">Platform 1%, split 50/50. Hook fee 80% to 1% over 10s. LP 0.1%.</p>
          </section>
        ) : null}
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
