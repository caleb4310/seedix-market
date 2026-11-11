/** Chain id comes from the environment. There is no silent testnet default. */
export function configuredChainId(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.CHAIN_ID ?? env.NEXT_PUBLIC_CHAIN_ID ?? "").trim();
  if (!raw) throw new Error("CHAIN_ID is required");
  if (!/^\d+$/.test(raw)) throw new Error("CHAIN_ID is invalid");
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("CHAIN_ID is invalid");
  return id;
}

/** A missing or malformed address is a hard failure. Callers must not substitute a testnet address. */
export function requiredAddress(name: string, env: Record<string, string | undefined> = process.env): `0x${string}` {
  const value = (env[name] ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} is required`);
  return value as `0x${string}`;
}
