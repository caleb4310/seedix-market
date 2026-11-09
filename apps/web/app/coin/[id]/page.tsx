import { CoinScreen } from "@/components/CoinScreen";

export default async function CoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ side?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const side = query.side === "sell" ? "sell" : "buy";
  return <CoinScreen id={id} side={side} />;
}
