import { activeChain } from "@seedix/shared";

function flag(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return undefined;
}

/** ZRO holder-tax controls. On for Base Sepolia unless the env turns them off. Off for Elysium. */
export function zroTaxEnabled(): boolean {
  const set = flag("NEXT_PUBLIC_ZRO_TAX_ENABLED");
  if (set !== undefined) return set;
  return activeChain({
    CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID || process.env.CHAIN_ID,
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  }).zroTax;
}

/** Remote ZRO claims need a payout module that is not in the Base Sepolia deployment. Off unless set. */
export function zroRemoteClaimEnabled(): boolean {
  return flag("NEXT_PUBLIC_ZRO_REMOTE_CLAIM_ENABLED") === true;
}
