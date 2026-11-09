"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { parseUnits } from "viem";
import { hookPips, fees } from "@/lib/tokens";
import { modeLabel, type Coin } from "@/lib/mock";
import { elysiumTestnet } from "@/lib/chain";
import {
  DEFAULT_SLIPPAGE_PCT,
  formatAmount,
  formatImpact,
  parseSlippage,
  tradeQuote,
  type Side,
} from "@/lib/quote";
import { erc20Abi, explorerTx, explainTxError, priceLimit, routerAbi, routerAddress } from "@/lib/trade";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Tabs";
import { WalletButton } from "@/components/WalletButton";

export type TradePreview = "approval" | "pending" | "success" | "error" | "nowallet";

function pct(pips: number): string {
  return `${(pips / 10_000).toFixed(2)}%`;
}

const EXAMPLE_HASH = "0x4c1a9e20b7d4f0a18c33e95df6f2fde5bc45000000000000000000000000ab90" as const;

export function TradePanel({
  coin,
  initialSide = "buy",
  preview,
}: {
  coin: Coin;
  initialSide?: Side;
  preview?: TradePreview;
}) {
  const [side, setSide] = useState<Side>(initialSide);
  const [amount, setAmount] = useState(initialSide === "sell" ? "1000" : "100");
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PCT));
  const [now, setNow] = useState(coin.ageSec);
  const [confirmed, setConfirmed] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [phase, setPhase] = useState<"idle" | "approve" | "swap" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    const id = window.setInterval(() => setNow((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setConfirmed(false);
    setPhase("idle");
    setHash(undefined);
    setErrorText("");
  }, [side, amount, slippage, coin.id]);

  const elapsed = now;
  const hook = hookPips(elapsed);
  const decaying = hook > fees.endPips;
  const left = Math.max(0, fees.decaySeconds - elapsed);
  const gross = Number(amount) || 0;
  const slip = parseSlippage(slippage);
  const quote = tradeQuote({
    side,
    amount: gross,
    price: coin.price,
    mcap: coin.mcap,
    hookPips: hook,
    slippagePct: slip.ok ? slip.pct : 0,
  });
  const receiveUnit = quote.receiveUnit === "coin" ? coin.ticker : coin.pair;
  const hookUnit = quote.hookUnit === "coin" ? coin.ticker : coin.pair;
  const spendToken = side === "buy" ? coin.pairAddress : coin.tokenAddress;
  const onNetwork = isConnected && chainId === elysiumTestnet.id;
  const allowance = useReadContract({
    address: spendToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && routerAddress ? [address, routerAddress] : undefined,
    query: { enabled: Boolean(onNetwork && spendToken && routerAddress && address) },
  });

  const needsConfirm = decaying;
  const ready = gross > 0 && slip.ok && (!needsConfirm || confirmed);

  async function submit(kind: "approve" | "swap") {
    if (!address || !routerAddress || !coin.tokenAddress || !coin.pairAddress || !coin.hooks) {
      setPhase("error");
      setErrorText("This coin is mock data. The router is not deployed on Elysium testnet, so no transaction was sent.");
      return;
    }
    const tokenIn = side === "buy" ? coin.pairAddress : coin.tokenAddress;
    const coinIsToken0 = Boolean(coin.coinIsToken0);
    const zeroForOne = side === "buy" ? !coinIsToken0 : coinIsToken0;
    try {
      setPhase(kind);
      const tx =
        kind === "approve"
          ? await writeContractAsync({
              address: tokenIn,
              abi: erc20Abi,
              functionName: "approve",
              args: [routerAddress, parseUnits(amount || "0", 18)],
              chainId: elysiumTestnet.id,
            })
          : await writeContractAsync({
              address: routerAddress,
              abi: routerAbi,
              functionName: "swap",
              args: [
                {
                  currency0: coinIsToken0 ? coin.tokenAddress : coin.pairAddress,
                  currency1: coinIsToken0 ? coin.pairAddress : coin.tokenAddress,
                  fee: 1000,
                  tickSpacing: 60,
                  hooks: coin.hooks,
                },
                zeroForOne,
                -parseUnits(amount || "0", 18),
                parseUnits(Math.max(quote.minReceived, 0).toFixed(18), 18),
                BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
                priceLimit(zeroForOne),
              ],
              chainId: elysiumTestnet.id,
            });
      setHash(tx);
    } catch (err) {
      setPhase("error");
      setHash(undefined);
      setErrorText(explainTxError(err));
    }
  }

  const allowanceLow =
    allowance.data !== undefined && spendToken !== undefined && allowance.data < parseUnits(amount || "0", 18);
  const showApproval = preview === "approval" || (phase === "approve" && !receipt.isSuccess) || (ready && onNetwork && allowanceLow && phase === "idle");
  const showPending = preview === "pending" || (Boolean(hash) && receipt.isLoading);
  const showSuccess = preview === "success" || (Boolean(hash) && receipt.isSuccess && phase === "swap");
  const showError = preview === "error" || phase === "error";
  const shownHash = preview === "pending" || preview === "success" ? EXAMPLE_HASH : hash;

  return (
    <Card className="trade">
      <Tabs
        label="Trade side"
        value={side}
        onChange={setSide}
        options={[
          { id: "buy", label: "Buy" },
          { id: "sell", label: "Sell" },
        ]}
      />
      <Field label={`Amount · ${side === "buy" ? coin.pair : coin.ticker}`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </Field>
      <Field label="Slippage" className="stack-top">
        <span className="suffix">
          <input
            className="narrow-input"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            inputMode="decimal"
            aria-invalid={!slip.ok}
            aria-label="Slippage percent"
          />
          <span>%</span>
        </span>
      </Field>
      {!slip.ok ? <p className="field-error">{slip.message}</p> : null}
      {slip.ok && slip.warn ? (
        <p className="field-warn">Slippage above 5% can fill at a much worse price. The value you typed is what will be used.</p>
      ) : null}
      {needsConfirm ? (
        <div className="fee-warn" role="alert">
          <strong>Hook fee is {pct(hook)}</strong>
          <p>
            Fee drops to 1% in {left}s. This {side} pays {formatAmount(quote.hookAmt)} {hookUnit} to the hook, on top of the 1% platform fee.
          </p>
        </div>
      ) : null}
      <dl className="receipt">
        <div>
          <dt>{side === "sell" ? "You receive" : "You receive ≈"}</dt>
          <dd>
            {formatAmount(quote.received)} {receiveUnit}
          </dd>
        </div>
        <div>
          <dt>Min received · {slip.ok ? slip.pct : slippage}% slippage</dt>
          <dd>
            {slip.ok ? formatAmount(quote.minReceived) : "—"} {receiveUnit}
          </dd>
        </div>
        <div>
          <dt>Price impact</dt>
          <dd>{formatImpact(quote.impact)}</dd>
        </div>
        <div>
          <dt>Platform 1%</dt>
          <dd>
            {formatAmount(quote.platAmt)} {coin.pair}
          </dd>
        </div>
        <div>
          <dt>Hook {pct(hook)}</dt>
          <dd>
            {formatAmount(quote.hookAmt)} {hookUnit}
          </dd>
        </div>
        <div>
          <dt>LP 0.10%</dt>
          <dd>
            {formatAmount(quote.lpAmt)} {side === "buy" ? coin.pair : coin.ticker}
          </dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{modeLabel(coin.mode)}</dd>
        </div>
      </dl>
      {needsConfirm ? (
        <label className="confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            {side === "buy" ? "Buy" : "Sell"} anyway at {pct(hook)}. I know most of this order is the fee.
          </span>
        </label>
      ) : null}

      {preview === "nowallet" ? <WalletButton forceHelp /> : null}

      {showApproval ? (
        <div className="status">
          <strong>Approve {side === "buy" ? coin.pair : coin.ticker}</strong>
          <p className="note">The router can spend only this amount. Approval is a separate transaction from the swap.</p>
          {preview === "approval" ? null : (
            <Button variant="accent" block type="button" disabled={isPending} onClick={() => submit("approve")}>
              {isPending ? "Waiting for wallet" : `Approve ${side === "buy" ? coin.pair : coin.ticker}`}
            </Button>
          )}
        </div>
      ) : null}

      {showPending && shownHash ? (
        <div className="status" role="status">
          <strong>{phase === "approve" || preview === "pending" ? "Waiting for confirmation" : "Swap pending"}</strong>
          <p className="note">The transaction is in flight. This page updates when it is mined.</p>
          <a href={explorerTx(shownHash)}>{shownHash.slice(0, 10)}…{shownHash.slice(-6)}</a>
        </div>
      ) : null}

      {showSuccess && shownHash ? (
        <div className="status" data-tone="ok" role="status">
          <strong>Confirmed</strong>
          <p className="note">The swap was mined. Minimum received was sent with the transaction.</p>
          <a href={explorerTx(shownHash)}>{shownHash.slice(0, 10)}…{shownHash.slice(-6)}</a>
        </div>
      ) : null}

      {showError ? (
        <div className="status" data-tone="error" role="alert">
          <strong>Not sent</strong>
          <p className="note">{preview === "error" ? "The wallet rejected the swap. Nothing moved." : errorText}</p>
          {hash ? <a href={explorerTx(hash)}>{hash.slice(0, 10)}…{hash.slice(-6)}</a> : null}
        </div>
      ) : null}

      {!isConnected && preview !== "nowallet" ? (
        <WalletButton />
      ) : isConnected && chainId !== elysiumTestnet.id ? (
        <Button variant="accent" block type="button" onClick={() => switchChain({ chainId: elysiumTestnet.id })}>
          Switch to Elysium testnet
        </Button>
      ) : (
        <Button
          variant="accent"
          block
          type="button"
          disabled={!ready || isPending || showPending || showApproval}
          onClick={() => submit("swap")}
        >
          {needsConfirm && !confirmed ? `Confirm ${pct(hook)} fee` : isPending ? "Waiting for wallet" : `Sign ${side}`}
        </Button>
      )}
      <p className="note">
        A real swap sends amountOutMin or amountInMax, a 20 minute deadline, and a price limit. Nothing is marked confirmed until the chain returns a hash.
      </p>
    </Card>
  );
}

export function Claims({ coin }: { coin: Coin }) {
  const { address, isConnected } = useAccount();
  const eligible = isConnected && address?.toLowerCase() === coin.recipient.toLowerCase();
  const pots =
    coin.mode === "keep"
      ? [
          ["Creator pair", `12.40 ${coin.pair}`, "Claim"],
          ["Creator coin", `0 ${coin.ticker}`, "Claim"],
        ]
      : coin.mode === "kickback"
        ? [
            ["Kickback round", "In review", "After review"],
            ["Creator coin", `1.02 ${coin.ticker}`, "Claim"],
          ]
        : [
            ["Burn pair", `6.55 ${coin.pair}`, "Queued"],
            ["Burn coin", `440 ${coin.ticker}`, "Burn"],
          ];
  return (
    <section className="claims">
      <p className="kicker">Fee recipient</p>
      <p className="note">
        {eligible
          ? "This wallet can claim the creator pots."
          : "Claim buttons show only for the fee-recipient wallet. Burn pots are not a claim. Kickback pays holders after the review hour."}
      </p>
      {pots.map(([label, amount, action]) => (
        <div className="claim" key={label}>
          <div>
            <strong>{label}</strong>
            <div className="ticker">{amount}</div>
          </div>
          {action === "Burn" ? (
            <Button variant="secondary" type="button">
              Burn
            </Button>
          ) : eligible && action === "Claim" ? (
            <Button variant="secondary" type="button">
              Claim
            </Button>
          ) : (
            <span className="ticker">{action === "Claim" ? "Recipient only" : action}</span>
          )}
        </div>
      ))}
    </section>
  );
}
