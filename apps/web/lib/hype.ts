"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "./api";

/** Cached HYPE/USD from the API. Null means the feed is unavailable and the UI stays in HYPE. */
export function useHypeUsd(): number | null {
  const [usd, setUsd] = useState<number | null>(null);
  useEffect(() => {
    if (!apiUrl) return;
    let cancel = false;
    fetch(`${apiUrl}/price/hype`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { usd?: number | null } | null) => {
        if (!cancel && body && typeof body.usd === "number" && body.usd > 0) setUsd(body.usd);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);
  return usd;
}
