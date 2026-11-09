"use client";

import { Button } from "@/components/ui/Button";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="state-page">
      <p className="kicker">Error</p>
      <h1>This page failed to render</h1>
      <p className="lede">{error.message || "Something in the app threw. Nothing was sent to the network."}</p>
      <p className="stack-top">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
      </p>
    </div>
  );
}
