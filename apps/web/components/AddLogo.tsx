"use client";

import { useRef, useState } from "react";
import type { Hex } from "viem";
import { useAccount, useSignTypedData } from "wagmi";
import { apiUrl } from "@/lib/api";
import { canAddLogo, retryLogo, type LogoSign } from "@/lib/logoRetry";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function AddLogo({
  poolId,
  creator,
  recipient,
  image,
  onAdded,
}: {
  poolId?: Hex;
  creator?: string;
  recipient?: string;
  image?: string | null;
  onAdded: (url: string) => void;
}) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const allowed = Boolean(apiUrl && poolId && canAddLogo({ connected: address, creator, recipient, image }));
  if (!allowed || !poolId || !address) return null;

  async function onFile(file: File) {
    if (!poolId || !address) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sign: LogoSign = (typed) =>
        typed.primaryType === "LogoUpload" ? signTypedDataAsync(typed) : signTypedDataAsync(typed);
      const result = await retryLogo({ poolId, address, bytes, sign });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      onAdded(result.url);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Logo file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <Button type="button" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? "Adding logo…" : "Add logo"}
      </Button>
    </>
  );
}
