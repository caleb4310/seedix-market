import { readFileSync } from "node:fs";
import { activeChain, type ActiveChain } from "@seedix/shared";

export type DeploymentFile = {
  startBlock: number;
  poolManager: string;
  buybackExecutor: string;
  kickbackDistributor: string;
  hook: string;
  launcher: string;
  metadata: string;
};

/** Addresses and the start block come from the deployment file for the active chain. */
export function loadDeployment(file?: string, chain: ActiveChain = activeChain()): DeploymentFile {
  const fallback: DeploymentFile = {
    startBlock: chain.startBlock,
    poolManager: "",
    buybackExecutor: "",
    kickbackDistributor: "",
    hook: "",
    launcher: "",
    metadata: "",
  };
  const path = file && file.length > 0 ? file : new URL(`../../../deployments/${chain.deploymentFile}`, import.meta.url);
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
