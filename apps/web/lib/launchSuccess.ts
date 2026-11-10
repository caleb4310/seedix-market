/** After a confirmed launch the form closes, the coin page opens, and the fields reset. */
export function launchSuccess(poolId: string | null): { href: string; reset: true } | null {
  if (!poolId || !/^0x[0-9a-fA-F]{64}$/.test(poolId)) return null;
  return { href: `/coin/${poolId}`, reset: true };
}
