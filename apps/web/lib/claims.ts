/** The claim card copy. Proofs are not fetched until a wallet is connected. */
export function claimNotice(connected: boolean, claimsConfigured: boolean, proofCount: number | null): string | null {
  if (!connected) return "Connect a wallet to see claims.";
  if (!claimsConfigured) return "Set the API URL to load merkle proofs. Failed-transfer credits below still come from the contract.";
  if (proofCount === null) return "Loading claim proofs.";
  if (proofCount === 0) return "No merkle claim is waiting for this wallet.";
  return null;
}
