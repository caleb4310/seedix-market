"use client";

import { useEffect, useState } from "react";
import { apiUrl, getKickbacks, kickbackKind, type KickbackRow } from "@/lib/api";
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
  useEffect(() => {
    if (!apiUrl || !poolId) return;
    let cancel = false;
    getKickbacks(poolId)
      .then((body) => {
        if (!cancel) setRows(body.payouts);
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
      {rows.length === 0 ? <p className="lede">No Kickback payments yet.</p> : null}
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
