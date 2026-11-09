import { CoinScreen } from "@/components/CoinScreen";
import type { TradePreview } from "@/components/TradePanel";

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
  const side = query.side === "sell" ? "sell" : "buy";
  const preview =
    process.env.NODE_ENV !== "production" && previews.has(query.state ?? "")
      ? (query.state as TradePreview)
      : undefined;
  return <CoinScreen id={id} side={side} preview={preview} />;
}
