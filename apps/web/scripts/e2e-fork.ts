/**
 * Fork 99801 and run the browser trade test.
 * Not in CI: it depends on the public Elysium RPC.
 *
 *   npm run test:e2e:fork -w @seedix/web
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const webRoot = path.resolve(import.meta.dirname, "..");
const foundry = path.join(process.env.HOME ?? "", ".foundry", "bin");
const env = {
  ...process.env,
  PATH: existsSync(foundry) ? `${foundry}${path.delimiter}${process.env.PATH ?? ""}` : process.env.PATH,
};
const anvilRpc = "http://127.0.0.1:18545";
const claimsPort = 8787;
const manifestDir = "/tmp/seedix-e2e-manifests";
const forkRpc = process.env.FORK_RPC_URL || "https://testnet-rpc.elysium.kinetiq.xyz";
const children: ChildProcess[] = [];

function start(command: string, args: string[], extra: NodeJS.ProcessEnv = {}, cwd = webRoot): ChildProcess {
  const child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: "inherit", detached: true });
  children.push(child);
  return child;
}

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(anvilRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result;
}

async function waitFor(url: string, attempts = 90): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      await delay(1000);
    }
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function stop(): Promise<void> {
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await delay(400);
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function addressesForFork(): Promise<Record<string, string>> {
  const file = JSON.parse(readFileSync(path.resolve(webRoot, "../../deployments/99801.json"), "utf8")) as {
    contracts: { launcher: string };
    tokens: { whype: string };
  };
  const code = String(await rpc("eth_getCode", [file.contracts.launcher, "latest"]));
  if (code.toLowerCase().includes("97a5d5b5")) {
    console.log("launcher in deployments/99801.json matches the current ABI");
    return {};
  }
  console.log("launcher bytecode has no statusOf; deploying a fresh stack on the fork");
  const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  await rpc("anvil_setBalance", [deployer, `0x${(1000n * 10n ** 18n).toString(16)}`]);
  await rpc("eth_sendTransaction", [{
    from: deployer,
    to: file.tokens.whype,
    data: "0xd0e30db0",
    value: `0x${(3n * 10n ** 18n).toString(16)}`,
  }]);
  const forge = spawnSync(
    "forge",
    ["script", "script/Deploy.s.sol", "--rpc-url", anvilRpc, "--broadcast", "--skip-simulation", "-vv"],
    {
      cwd: path.resolve(webRoot, "../../contracts"),
      env: {
        ...env,
        PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        ADMIN: deployer,
      },
      encoding: "utf8",
      timeout: 900_000,
    },
  );
  const output = `${forge.stdout ?? ""}\n${forge.stderr ?? ""}`;
  const pick = (label: string) => output.match(new RegExp(`${label}:?\\s+(0x[0-9a-fA-F]{40})`))?.[1] ?? "";
  const launcher = pick("launcher");
  if (forge.status !== 0 || !launcher) {
    console.error(output.slice(-2500));
    console.error("fresh deploy did not replace the launcher; the fork keeps deployments/99801.json");
    return {};
  }
  console.log(`fork launcher ${launcher}`);
  return {
    NEXT_PUBLIC_LAUNCHER: launcher,
    NEXT_PUBLIC_ROUTER: pick("router"),
    NEXT_PUBLIC_QUOTER: pick("quoter"),
    NEXT_PUBLIC_HOOK: pick("hook"),
    NEXT_PUBLIC_STATE_VIEW: pick("stateView"),
    NEXT_PUBLIC_KICKBACK: pick("distributor"),
    NEXT_PUBLIC_COIN_METADATA: pick("metadata"),
    NEXT_PUBLIC_WHYPE: pick("whype"),
  };
}

async function main(): Promise<void> {
  const install = start("npx", ["playwright", "install", "chromium"]);
  const installCode = await new Promise<number>((resolve) => install.on("exit", (value) => resolve(value ?? 1)));
  if (installCode !== 0) throw new Error("playwright install failed");
  await rm(manifestDir, { recursive: true, force: true });
  await mkdir(manifestDir, { recursive: true });
  const anvil = start("anvil", [
    "--fork-url",
    forkRpc,
    "--port",
    "18545",
    "--host",
    "127.0.0.1",
    "--chain-id",
    "99801",
    "--hardfork",
    "cancun",
    "--gas-limit",
    "100000000",
  ]);
  anvil.on("exit", (code) => {
    if (code && code !== 0) console.error(`anvil exited ${code}`);
  });
  for (let i = 0; i < 90; i += 1) {
    try {
      const chainId = await rpc("eth_chainId");
      if (typeof chainId === "string" && BigInt(chainId) === 99801n) break;
    } catch {
      await delay(1000);
    }
    if (i === 89) throw new Error("anvil did not fork 99801");
  }
  const block = BigInt((await rpc("eth_blockNumber")) as string);
  const forkEnv = await addressesForFork();
  const forkEnvPath = "/tmp/seedix-fork-env.json";
  writeFileSync(forkEnvPath, JSON.stringify(forkEnv));
  const { createServer } = await import("node:http");
  const { handleRequest } = await import("../../../services/api/src/routes.ts");
  const db = { async query() { return { rows: [], rowCount: 0 }; } };
  const claims = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" });
      res.end();
      return;
    }
    handleRequest(db, req.method ?? "GET", url.pathname, url.searchParams)
      .then((result) => {
        res.writeHead(result.status, {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        });
        res.end(JSON.stringify(result.json));
      })
      .catch(() => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unavailable" }));
      });
  });
  await new Promise<void>((resolve) => claims.listen(claimsPort, "127.0.0.1", resolve));
  process.env.KICKBACK_MANIFEST_DIR = manifestDir;
  const web = start("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3011"], {
    NEXT_PUBLIC_RPC_URL: anvilRpc,
    NEXT_PUBLIC_CHAIN_ID: "99801",
    NEXT_PUBLIC_CLAIMS_URL: `http://127.0.0.1:${claimsPort}`,
    NEXT_PUBLIC_API_URL: "",
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "",
    NEXT_PUBLIC_INDEXER_START_BLOCK: block.toString(),
    KICKBACK_MANIFEST_DIR: manifestDir,
    ...forkEnv,
  });
  void web;
  await waitFor("http://127.0.0.1:3011/launch");
  const test = start("npx", ["playwright", "test", "--config", "playwright.fork.config.ts"], {
    FORK_RPC: anvilRpc,
    MANIFEST_DIR: manifestDir,
    INDEXER_START_BLOCK: block.toString(),
    FORK_ENV: forkEnvPath,
  });
  const code = await new Promise<number>((resolve) => test.on("exit", (value) => resolve(value ?? 1)));
  claims.close();
  if (code !== 0) throw new Error(`playwright exited ${code}`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => stop());
