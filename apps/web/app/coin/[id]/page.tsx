import { notFound } from "next/navigation";
import { TradePanel, type TradePreview } from "@/components/TradePanel";
import { CoinBody } from "@/components/CoinBody";
import { getCoin } from "@/lib/mock";

const previews = new Set(["approval", "pending", "success", "error", "nowallet"]);

export default async function CoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ side?: string; state?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const coin = getCoin(id);
  if (!coin) notFound();
  const side = query.side === "sell" ? "sell" : "buy";
  const preview = previews.has(query.state ?? "") ? (query.state as TradePreview) : undefined;
  return (
    <div className="coin-layout">
      <CoinBody coin={coin} />
      <TradePanel coin={coin} initialSide={side} preview={preview} />
    </div>
  );
}
