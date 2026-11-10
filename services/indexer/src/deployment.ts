import { readFileSync } from "node:fs";
import { deployment99801 as shared } from "@seedix/shared";

export type DeploymentFile = {
  startBlock: number;
  poolManager: string;
  buybackExecutor: string;
  kickbackDistributor: string;
  hook: string;
  launcher: string;
  metadata: string;
};

/** Addresses and the start block come from deployments/99801.json. Shared constants are the fallback. */
export function loadDeployment(file?: string): DeploymentFile {
  const fallback: DeploymentFile = {
    startBlock: shared.startBlock,
    poolManager: shared.poolManager,
    buybackExecutor: shared.buybackExecutor,
    kickbackDistributor: shared.kickbackDistributor,
    hook: shared.hook,
    launcher: shared.launcher,
    metadata: "",
  };
  const path = file && file.length > 0 ? file : new URL("../../../deployments/99801.json", import.meta.url);
  try {
    const json = JSON.parse(readFileSync(path, "utf8")) as {
      startBlock?: number;
      contracts?: Record<string, string>;
    };
    const contracts = json.contracts ?? {};
    return {
      startBlock: Number(json.startBlock ?? fallback.startBlock),
      poolManager: contracts.poolManager ?? fallback.poolManager,
      buybackExecutor: contracts.buybackExecutor ?? fallback.buybackExecutor,
      kickbackDistributor: contracts.kickbackDistributor ?? fallback.kickbackDistributor,
      hook: contracts.launchHook ?? fallback.hook,
      launcher: contracts.launcher ?? fallback.launcher,
      metadata: contracts.coinMetadata ?? fallback.metadata,
    };
  } catch {
    return fallback;
  }
}
