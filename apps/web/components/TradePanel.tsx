"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useReadContract, useReadContracts, useSimulateContract } from "wagmi";
import { hookPips, fees } from "@/lib/tokens";
import type { Coin } from "@/lib/coin";
import { elysiumTestnet } from "@/lib/chain";
import { formatTokenAmount, parseTokenAmount } from "@/lib/amounts";
import { coinAge, modeLabel } from "@/lib/coin";
import { hookAddress, quoterAbi, quoterAddress, routerAddress } from "@/lib/trade";
import { decimalsAbi, hookConfigAbi } from "@/lib/abi";
import { freshQuote, spendState } from "@/lib/onchain";
import { DEFAULT_SLIPPAGE_PCT, formatAmount, parseSlippage, type Side } from "@/lib/quote";
import { UINT128_MAX } from "@/lib/protocol";
import { poolKey, quoteParams, quotedAmount, swapLimit, tradeSteps, type SwapKind, zeroForOne as swapDirection } from "@/lib/swap";
import { DEFAULT_DEADLINE_MINUTES, deadlineFromNow, explainTxError, parseDeadlineMinutes } from "@/lib/tx";
import { useContractTx } from "@/lib/useTx";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Tabs";
import { TxStatus } from "@/components/TxStatus";
import { WalletButton } from "@/components/WalletButton";

function pct(pips: number): string {
  return `${(pips / 10_000).toFixed(2)}%`;
}

export function TradePanel({ coin, initialSide = "buy" }: { coin: Coin; initialSide?: Side }) {
  const [side, setSide] = useState<Side>(initialSide);
  const [kind, setKind] = useState<SwapKind>("exactIn");
  const [amount, setAmount] = useState(initialSide === "sell" ? "1000" : "100");
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PCT));
  const [deadline, setDeadline] = useState(String(DEFAULT_DEADLINE_MINUTES));
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [confirmed, setConfirmed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState("");
  const tx = useContractTx();

  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setConfirmed(false);
    setPrepError("");
    tx.reset();
  }, [side, kind, amount, slippage, deadline, coin.id]);

  const [opened] = useState(() => Math.floor(Date.now() / 1000));
  const elapsed = coin.launchTime !== undefined ? coinAge(coin, now) : coin.ageSec + Math.max(0, now - opened);
  const hook = hookPips(elapsed);
  const decaying = hook > fees.endPips;
  const left = Math.max(0, fees.decaySeconds - elapsed);
  const gross = Number(amount) || 0;
  const slip = parseSlippage(slippage);
  const minutes = parseDeadlineMinutes(deadline);
  const receiveUnit = side === "buy" ? coin.ticker : coin.pair;
  const hookUnit = side === "buy" ? coin.pair : coin.ticker;
  const hooks = coin.hooks ?? (hookAddress || undefined);
  const poolReady = Boolean(coin.tokenAddress && coin.pairAddress && hooks && coin.poolId);
  const built = poolReady ? poolKey(coin.tokenAddress!, coin.pairAddress!, hooks!) : undefined;
  const config = useReadContract({
    address: hookAddress || undefined,
    abi: hookConfigAbi,
    functionName: "config",
    args: coin.poolId ? [coin.poolId] : undefined,
    query: { enabled: Boolean(hookAddress && coin.poolId) },
  });
  const configRow = config.data as readonly unknown[] | undefined;
  const coinIsToken0 = configRow ? Boolean(configRow[2]) : Boolean(coin.coinIsToken0);
  const direction = swapDirection(side, coinIsToken0);
  const spendToken = side === "buy" ? coin.pairAddress : coin.tokenAddress;
  const receiveToken = side === "buy" ? coin.tokenAddress : coin.pairAddress;
  const decimals = useReadContracts({
    contracts: [
      { address: spendToken, abi: decimalsAbi, functionName: "decimals" },
      { address: receiveToken, abi: decimalsAbi, functionName: "decimals" },
    ],
    query: { enabled: Boolean(spendToken && receiveToken) },
  });
  const spendDecimals = decimals.data?.[0]?.status === "success" ? Number(decimals.data[0].result) : undefined;
  const receiveDecimals = decimals.data?.[1]?.status === "success" ? Number(decimals.data[1].result) : undefined;
  let typedAmount: bigint | undefined;
  try {
    typedAmount = spendDecimals !== undefined && gross > 0 ? parseTokenAmount(amount, kind === "exactIn" ? spendDecimals : (receiveDecimals ?? spendDecimals)) : undefined;
  } catch {
    typedAmount = undefined;
  }
  const quoted = useSimulateContract({
    address: quoterAddress || undefined,
    abi: quoterAbi,
    functionName: kind === "exactIn" ? "quoteExactInputSingle" : "quoteExactOutputSingle",
    account: address ?? "0x0000000000000000000000000000000000000001",
    args:
      poolReady && built && typedAmount && typedAmount <= UINT128_MAX
        ? [quoteParams(built.key, direction, typedAmount)]
        : undefined,
    query: { enabled: Boolean(poolReady && quoterAddress && typedAmount), refetchInterval: 20_000 },
  });
  const amountQuoted = quotedAmount(quoted.data?.result);
  const minOut = amountQuoted !== undefined && slip.ok && kind === "exactIn" ? swapLimit("exactIn", amountQuoted, slip.pct) : undefined;
  const maxIn = amountQuoted !== undefined && slip.ok && kind === "exactOut" ? swapLimit("exactOut", amountQuoted, slip.pct) : undefined;
  const quoteAge = quoted.dataUpdatedAt > 0 ? Math.max(0, now - Math.floor(quoted.dataUpdatedAt / 1000)) : null;
  const quoteStale = quoteAge !== null && quoteAge >= 12;
  const onNetwork = isConnected && chainId === elysiumTestnet.id;
  const needsConfirm = decaying;
  const quoteReady = Boolean(amountQuoted !== undefined && slip.ok && minutes.ok && typedAmount && spendDecimals !== undefined);
  const ready = gross > 0 && quoteReady && (!needsConfirm || confirmed);
  const busy = preparing || tx.state.status === "awaiting_signature" || tx.state.status === "pending";

  async function submit() {
    if (!address || !built || !spendToken || !typedAmount || !slip.ok || !minutes.ok) {
      setPrepError("Quote unavailable. Nothing was sent.");
      return;
    }
    setPreparing(true);
    setPrepError("");
    tx.reset();
    try {
      const fresh = await freshQuote({ kind, key: built.key, zeroForOne: direction, amount: typedAmount });
      const funds = await spendState(spendToken, address);
      const steps = tradeSteps({
        action: side === "buy" ? "Buy" : "Sell",
        kind,
        spendToken,
        spendLabel: side === "buy" ? coin.pair : coin.ticker,
        key: built.key,
        zeroForOne: direction,
        typedAmount,
        quoted: fresh,
        slippagePct: slip.pct,
        deadline: deadlineFromNow(minutes.minutes, Math.floor(Date.now() / 1000)),
        allowance: funds.allowance,
        tokenBalance: funds.balance,
        nativeBalance: funds.native,
      });
      if ("error" in steps) {
        setPrepError(steps.error);
        return;
      }
      await tx.send(steps.steps);
      void quoted.refetch();
    } catch (err) {
      setPrepError(explainTxError(err));
    } finally {
      setPreparing(false);
    }
  }

  const shown = tx.state.status === "idle" && prepError ? { status: "failed" as const, message: prepError } : tx.state;
  const limitText =
    kind === "exactIn"
      ? minOut !== undefined && receiveDecimals !== undefined
        ? `${formatTokenAmount(minOut, receiveDecimals)} ${receiveUnit}`
        : "—"
      : maxIn !== undefined && spendDecimals !== undefined
        ? `${formatTokenAmount(maxIn, spendDecimals)} ${side === "buy" ? coin.pair : coin.ticker}`
        : "—";

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
      <Tabs
        label="Amount mode"
        size="sm"
        value={kind}
        onChange={setKind}
        options={[
          { id: "exactIn", label: "Spend exact" },
          { id: "exactOut", label: "Receive exact" },
        ]}
      />
      <Field label={`Amount · ${kind === "exactIn" ? (side === "buy" ? coin.pair : coin.ticker) : receiveUnit}`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </Field>
      <div className="grid-2 stack-top">
        <Field label="Slippage">
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
        <Field label="Deadline">
          <span className="suffix">
            <input
              className="narrow-input"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              inputMode="numeric"
              aria-invalid={!minutes.ok}
              aria-label="Deadline minutes"
            />
            <span>min</span>
          </span>
        </Field>
      </div>
      {!slip.ok ? <p className="field-error">{slip.message}</p> : null}
      {!minutes.ok ? <p className="field-error">{minutes.message}</p> : null}
      {slip.ok && slip.warn ? (
        <p className="field-warn">Slippage above 5% can fill at a much worse price. The value you typed is what will be used.</p>
      ) : null}
      {needsConfirm ? (
        <div className="fee-warn" role="alert">
          <strong>Hook fee is {pct(hook)}</strong>
          <p>
            Fee drops to 1% in {left}s. This {side} pays {formatAmount(gross * (hook / 1_000_000))} {hookUnit} to the hook, on top of the 1% platform fee.
          </p>
        </div>
      ) : null}
      {!quoteReady ? (
        <p className={poolReady && quoterAddress ? "field-error" : "note"}>
          {poolReady && quoterAddress
            ? quoted.error
              ? "Quote unavailable. The quoter did not return a price."
              : "Quote unavailable until the on-chain quote succeeds."
            : "This coin has no pool yet, so a trade cannot be signed."}
        </p>
      ) : null}
      <dl className="receipt">
        <div>
          <dt>{kind === "exactOut" ? "You pay at most" : "You receive ≈"}</dt>
          <dd>
            {kind === "exactIn"
              ? amountQuoted !== undefined && receiveDecimals !== undefined
                ? `${formatTokenAmount(amountQuoted, receiveDecimals)} ${receiveUnit}`
                : "—"
              : amountQuoted !== undefined && spendDecimals !== undefined
                ? `${formatTokenAmount(amountQuoted, spendDecimals)} ${side === "buy" ? coin.pair : coin.ticker}`
                : "—"}
          </dd>
        </div>
        <div>
          <dt>{kind === "exactIn" ? `Minimum received · ${slip.ok ? slip.pct : slippage}% slippage` : `Maximum spent · ${slip.ok ? slip.pct : slippage}% slippage`}</dt>
          <dd>{limitText}</dd>
        </div>
        <div>
          <dt>Router</dt>
          <dd>{routerAddress ? "SeedixRouter" : "—"}</dd>
        </div>
        <div>
          <dt>Platform 1%</dt>
          <dd>{side === "sell" ? "From the output" : `${formatAmount(gross * 0.01)} ${coin.pair}`}</dd>
        </div>
        <div>
          <dt>Hook {pct(hook)}</dt>
          <dd>
            {formatAmount(gross * (hook / 1_000_000))} {hookUnit}
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
      {quoteAge !== null ? (
        <p className={quoteStale ? "field-warn" : "note"}>
          {quoteStale ? `Quote is ${quoteAge}s old. Signing refreshes it.` : `Quote updated ${quoteAge}s ago.`}
        </p>
      ) : null}
      <TxStatus state={shown} />
      {!isConnected ? (
        <div className="stack-top">
          <WalletButton prominent />
        </div>
      ) : !onNetwork ? (
        <WalletButton />
      ) : (
        <Button variant="accent" block type="button" disabled={!ready || busy} onClick={() => void submit()}>
          {needsConfirm && !confirmed ? `Confirm ${pct(hook)} fee` : preparing ? "Checking the transaction" : tx.state.status === "awaiting_signature" ? "Confirm in your wallet" : tx.state.status === "pending" ? "Waiting for confirmation" : side === "buy" ? "Trade" : "Sell"}
        </Button>
      )}
      <p className="note">
        Slippage sets the {kind === "exactIn" ? "minimum received" : "maximum spent"}. The deadline is {minutes.ok ? minutes.minutes : deadline} minutes. Approval is the exact amount, to the router.
      </p>
    </Card>
  );
}
