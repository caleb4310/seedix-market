/** Reown project ids are 32 hex characters. Anything else, including the example placeholder, stays disabled. */
export function walletConnectProjectId(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return /^[0-9a-fA-F]{32}$/.test(trimmed) ? trimmed : "";
}
