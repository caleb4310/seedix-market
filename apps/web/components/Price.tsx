export function Price({ value }: { value: number }) {
  if (!Number.isFinite(value) || value <= 0) return <>$0</>;
  if (value >= 1) return <>${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</>;
  const raw = value.toFixed(18);
  const match = raw.match(/^0\.(0+)([1-9]\d*)/);
  if (!match || match[1].length < 3) return <>${value.toPrecision(4)}</>;
  const digits = match[2].replace(/0+$/, "").slice(0, 4);
  return (
    <>
      $0.0<sub>{match[1].length}</sub>
      {digits}
    </>
  );
}
