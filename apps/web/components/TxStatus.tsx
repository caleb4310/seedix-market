"use client";

import { explorerTx } from "@/lib/deployment";
import type { TxState } from "@/lib/tx";

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.status === "idle") return null;
  const tone = state.status === "failed" ? "error" : state.status === "confirmed" ? "ok" : undefined;
  const title =
    state.status === "awaiting_signature"
      ? `Confirm ${state.action ?? "the transaction"} in your wallet`
      : state.status === "pending"
        ? `${state.action ?? "Transaction"} pending`
        : state.status === "confirmed"
          ? `${state.action ?? "Transaction"} confirmed`
          : "Not sent";
  return (
    <div className="status" data-tone={tone} role={state.status === "failed" ? "alert" : "status"}>
      <strong>{title}</strong>
      {state.message ? <p className="note">{state.message}</p> : null}
      {state.status === "pending" ? <p className="note">Waiting for the chain to mine this transaction.</p> : null}
      {state.hash ? (
        <a className="text-link" href={explorerTx(state.hash)}>
          {shortHash(state.hash)}
        </a>
      ) : null}
    </div>
  );
}
