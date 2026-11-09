import { elysiumTestnet } from "@seedix/shared";

/** ALTCHA, uploads, and the live-trade stream. Week 1 is config only. */
export const apiConfig = {
  chainId: elysiumTestnet.id,
  port: 3001,
  databaseUrl: process.env.DATABASE_URL ?? "",
  trustProxy: false,
};

export function main(): void {
  console.log(`api skeleton for chain ${apiConfig.chainId} on 127.0.0.1:${apiConfig.port}`);
}
