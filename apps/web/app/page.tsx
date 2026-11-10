import { Suspense } from "react";
import { CoinTable } from "@/components/CoinTable";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="coin-grid" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <div key={index} className="wall-card skeleton" />)}</div>}>
      <CoinTable />
    </Suspense>
  );
}
