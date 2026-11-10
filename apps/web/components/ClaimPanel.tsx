"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { kickbackAbi } from "@/lib/abi";
import { claimsUrl, getClaims, type ClaimProof } from "@/lib/api";
import { claimNotice } from "@/lib/claims";
import { formatTokenAmount } from "@/lib/amounts";
import type { Coin } from "@/lib/coin";
import { kickbackAddress } from "@/lib/deployment";
import { useContractTx } from "@/lib/useTx";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TxStatus } from "@/components/TxStatus";
import { WalletButton } from "@/components/WalletButton";

const poolId = /^0x[0-9a-fA-F]{64}$/;

export function ClaimPanel({ coin }: { coin: Coin }) {
  const { address, isConnected } = useAccount();
  const tx = useContractTx();
  const [proofs, setProofs] = useState<ClaimProof[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const id = coin.poolId;
  const enabled = Boolean(id && poolId.test(id) && kickbackAddress);

  const nextEpoch = useReadContract({
    address: kickbackAddress || undefined,
    abi: kickbackAbi,
    functionName: "nextEpoch",
    args: id ? [id] : undefined,
    query: { enabled, refetchInterval: 30_000 },
  });
  const latest = Number(nextEpoch.data ?? 0n);
  const epochs = latest > 0 ? Array.from({ length: Math.min(latest, 8) }, (_, index) => latest - index) : [];
  const credits = useReadContracts({
    contracts: epochs.map((epoch) => ({
      address: kickbackAddress,
      abi: kickbackAbi,
      functionName: "claimable" as const,
      args: [id, BigInt(epoch), address ?? "0x0000000000000000000000000000000000000000"],
    })),
    query: { enabled: Boolean(enabled && address && epochs.length > 0) },
  });

  useEffect(() => {
    if (!claimsUrl || !id || !address || !poolId.test(id)) {
      setProofs(null);
      return;
    }
    let cancel = false;
    getClaims(id, address)
      .then((body) => {
        if (!cancel) setProofs(body.claims);
      })
      .catch(() => {
        if (!cancel) setProofs([]);
      });
    return () => {
      cancel = true;
    };
  }, [id, address, refresh]);

  if (!enabled || !id) return null;

  async function claim(row: ClaimProof) {
    if (!address || !kickbackAddress) return;
    const receipt = await tx.send([
      {
        action: "Claim Kickback",
        address: kickbackAddress,
        abi: kickbackAbi,
        functionName: "claim",
        args: [id, BigInt(row.epoch), address, BigInt(row.amount), row.proof],
      },
    ]);
    if (receipt) setRefresh((value) => value + 1);
  }

  async function claimFailed(epoch: number) {
    if (!kickbackAddress) return;
    const receipt = await tx.send([
      {
        action: "Claim failed credit",
        address: kickbackAddress,
        abi: kickbackAbi,
        functionName: "claimFailed",
        args: [id, BigInt(epoch)],
      },
    ]);
    if (receipt) {
      setRefresh((value) => value + 1);
      void credits.refetch();
    }
  }

  const notice = claimNotice(
    isConnected,
    Boolean(claimsUrl),
    isConnected ? (proofs === null ? null : proofs.length) : null,
  );
  const failed = epochs.flatMap((epoch, index) => {
    const row = credits.data?.[index];
    const amount = row?.status === "success" ? (row.result as bigint) : 0n;
    return amount > 0n ? [{ epoch, amount }] : [];
  });

  return (
    <Card className="stack-top">
      <p className="kicker">Kickback</p>
      <h2>Claim</h2>
      {!isConnected ? (
        <div className="stack-top">
          <WalletButton prominent />
        </div>
      ) : null}
      {notice ? <p className="note">{notice}</p> : null}
      <div className="claims">
        {proofs?.map((row) => (
          <div key={`${row.epoch}-${row.amount}`} className="claim">
            <strong>Epoch {row.epoch}</strong>
            <p className="note">{formatTokenAmount(BigInt(row.amount), 18)} of the pair token.</p>
            <Button variant="accent" type="button" disabled={!isConnected || tx.state.status === "pending" || tx.state.status === "awaiting_signature"} onClick={() => void claim(row)}>
              Claim
            </Button>
          </div>
        ))}
        {failed.map((row) => (
          <div key={`failed-${row.epoch}`} className="claim">
            <strong>Failed transfer · epoch {row.epoch}</strong>
            <p className="note">{formatTokenAmount(row.amount, 18)} is credited on the distributor.</p>
            <Button variant="secondary" type="button" disabled={tx.state.status === "pending" || tx.state.status === "awaiting_signature"} onClick={() => void claimFailed(row.epoch)}>
              Claim failed credit
            </Button>
          </div>
        ))}
      </div>
      <TxStatus state={tx.state} />
    </Card>
  );
}
