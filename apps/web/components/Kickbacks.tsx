"use client";

import { useEffect, useState } from "react";
import { apiUrl, getKickbacks, kickbackKind, type KickbackEpoch, type KickbackRow } from "@/lib/api";
import { formatTokenAmount } from "@/lib/amounts";

function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function amountLabel(amount: string): string {
  try {
    return formatTokenAmount(BigInt(amount), 18);
  } catch {
    return amount;
  }
}

export function Kickbacks({ poolId }: { poolId?: string }) {
  const [rows, setRows] = useState<KickbackRow[] | null>(null);
  const [epochs, setEpochs] = useState<KickbackEpoch[]>([]);
  useEffect(() => {
    if (!apiUrl || !poolId) return;
    let cancel = false;
    getKickbacks(poolId)
      .then((body) => {
        if (!cancel) {
          setRows(body.payouts);
          setEpochs(body.epochs ?? []);
        }
      })
      .catch(() => {
        if (!cancel) setRows([]);
      });
    return () => {
      cancel = true;
    };
  }, [poolId]);
  if (!apiUrl || !poolId || rows === null) return null;
  return (
    <section className="activity">
      <h2>Kickbacks</h2>
      <p className="note">Rewards are sent to holders. Gas is paid from the round, not by the platform.</p>
      {epochs.map((epoch) => (
        <p key={epoch.epoch} className="activity-row">
          <span>Round {epoch.epoch}</span>
          <span className="num">Gross {amountLabel(epoch.funded)}</span>
          <span className="num">Gas {amountLabel(epoch.gasReimbursed)}</span>
          <span className="num">Paid {amountLabel(epoch.netDistributed)}</span>
        </p>
      ))}
      {rows.length === 0 && epochs.length === 0 ? <p className="lede">No Kickback payments yet.</p> : null}
      {rows.map((row) => (
        <p key={`${row.txHash}-${row.account}-${row.kind}`} className="activity-row">
          <span>{kickbackKind(row.kind)}</span>
          <span className="num">{amountLabel(row.amount)}</span>
          <span className="addr-short">{short(row.account)}</span>
          <span className="addr-full">{row.account}</span>
        </p>
      ))}
    </section>
  );
}
