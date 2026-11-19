/** Public RPCs reject eth_getLogs ranges above 50,000 blocks. Stay under that. */
export const LOG_SPAN = 40_000n;

export function logRanges(from: bigint, to: bigint, span = LOG_SPAN): { from: bigint; to: bigint }[] {
  if (to < from || span <= 0n) return [];
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let start = from; start <= to; start += span) {
    const end = start + span - 1n > to ? to : start + span - 1n;
    ranges.push({ from: start, to: end });
  }
  return ranges;
}

type LogQuery = {
  getLogs: (args: Record<string, unknown> & { fromBlock: bigint; toBlock: bigint }) => Promise<unknown[]>;
};

/** Reads logs in windows so a public RPC accepts the request. A failed window is skipped. */
export async function getLogsChunked(client: LogQuery, args: Record<string, unknown>, fromBlock: bigint, toBlock: bigint): Promise<unknown[]> {
  const ranges = logRanges(fromBlock, toBlock);
  const out: unknown[] = [];
  for (let index = 0; index < ranges.length; index += 6) {
    const parts = await Promise.all(
      ranges.slice(index, index + 6).map((range) =>
        client.getLogs({ ...args, fromBlock: range.from, toBlock: range.to }).catch(() => [] as unknown[]),
      ),
    );
    for (const part of parts) out.push(...part);
  }
  return out;
}
