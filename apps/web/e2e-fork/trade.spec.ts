import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { encodeAbiParameters, encodeFunctionData, decodeFunctionResult, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { buildTree, kickbackLeaf } from "../../../services/api/src/merkle.ts";

const deployment = JSON.parse(readFileSync(path.resolve(process.cwd(), "../../deployments/99801.json"), "utf8")) as {
  contracts: { launchHook: string; kickbackDistributor: string; seedixRouter: string };
  tokens: { whype: string };
  accounts: { admin: string };
};
const overlay = process.env.FORK_ENV ? JSON.parse(readFileSync(process.env.FORK_ENV, "utf8")) as Record<string, string> : {};

const rpcUrl = process.env.FORK_RPC ?? "http://127.0.0.1:18545";
const manifestDir = process.env.MANIFEST_DIR ?? "/tmp/seedix-e2e-manifests";
const account = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const hook = (overlay.NEXT_PUBLIC_HOOK || deployment.contracts.launchHook) as Address;
const distributor = (overlay.NEXT_PUBLIC_KICKBACK || deployment.contracts.kickbackDistributor) as Address;
const whype = (overlay.NEXT_PUBLIC_WHYPE || deployment.tokens.whype) as Address;

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const hookAbi = parseAbi([
  "function pots(bytes32) view returns (uint128 creatorPair, uint128 creatorCoin, uint128 kickbackPair, uint128 burnPair, uint128 burnCoin)",
]);
const kickAbi = parseAbi([
  "function fund(bytes32 id, uint128 amount) returns (uint64)",
  "function postRoot(bytes32 id, uint64 epochId, bytes32 root, bytes32 manifestHash)",
  "function nextEpoch(bytes32) view returns (uint64)",
  "function claimable(bytes32,uint64,address) view returns (uint256)",
  "function liabilities(address) view returns (uint256)",
  "function publisher() view returns (address)",
]);

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
  return body.result;
}

function word(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

async function call(to: Address, data: Hex): Promise<Hex> {
  return (await rpc("eth_call", [{ to, data }, "latest"])) as Hex;
}

async function balanceOf(token: Address, owner: Address): Promise<bigint> {
  const data = encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [owner] });
  return BigInt(await call(token, data));
}

function mapSlot(key: Hex, slot: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [key, slot]));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const selected = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const endpoint = "http://127.0.0.1:18545";
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    const ethereum = {
      isMetaMask: true,
      isRabby: true,
      selectedAddress: selected,
      chainId: "0x185d9",
      providers: [] as unknown[],
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [selected];
        if (method === "eth_chainId") return "0x185d9";
        if (method === "net_version") return "99801";
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
        const next = method === "eth_sendTransaction" && params?.[0] && typeof params[0] === "object"
          ? [{ ...(params[0] as object), from: selected }]
          : params;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: next }),
        });
        const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
        if (body.error) throw new Error(body.error.message || "The wallet request failed.");
        return body.result;
      },
      on(event: string, fn: (...args: unknown[]) => void) {
        const list = listeners.get(event) ?? [];
        list.push(fn);
        listeners.set(event, list);
      },
      removeListener() {},
    };
    ethereum.providers = [ethereum];
    Object.assign(window, { ethereum });
    window.dispatchEvent(new Event("ethereum#initialized"));
  });
});

async function connect(page: Page) {
  const headerWallet = page.locator("header").getByRole("button").last();
  await expect(headerWallet).toBeVisible();
  if (!/0x/i.test(await headerWallet.innerText())) {
    await headerWallet.click();
    await page.getByRole("button", { name: "Browser Wallet" }).click();
    await expect(headerWallet).toContainText(/0x/i);
  }
}

test("launch, buy, sell, and claim on an anvil fork", async ({ page }) => {
  await rpc("anvil_setBalance", [account, word(1_000n * 10n ** 18n)]);
  await page.goto("/launch");
  await connect(page);
  await page.getByPlaceholder("North star").fill("Fork coin");
  await page.getByPlaceholder("NSTR").fill("FORK");
  await page.getByRole("tab", { name: "Any coin" }).click();
  await page.getByRole("textbox", { name: "Token address" }).fill(whype);
  await page.getByRole("checkbox", { name: /not from the listed pairs/ }).check();
  const kickback = page.getByRole("radio", { name: /Kick back/ });
  await expect(kickback).toBeEnabled({ timeout: 30_000 });
  await kickback.click();
  const hold = page.getByRole("button", { name: "Hold to launch" });
  await expect(hold).toBeEnabled();
  await hold.focus();
  await page.keyboard.down(" ");
  await page.waitForTimeout(1200);
  await page.keyboard.up(" ");
  await expect(page.getByText("Launch confirmed")).toBeVisible({ timeout: 120_000 });
  const href = await page.getByRole("link", { name: "Open the new coin" }).getAttribute("href");
  if (!href) throw new Error("launch did not link the new coin");
  const poolId = href.split("/").pop() as Hex;

  await page.goto(href);
  await expect(page.getByRole("button", { name: "Sign buy" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("textbox", { name: /Amount/ }).fill("1");
  await page.waitForTimeout(400);
  const feeBox = page.getByRole("checkbox");
  if (await feeBox.isVisible()) await feeBox.check();
  const signBuy = page.getByRole("button", { name: "Sign buy" });
  await expect(signBuy).toBeEnabled({ timeout: 60_000 });
  const whypeBefore = await balanceOf(whype, account);
  const nativeBefore = BigInt((await rpc("eth_getBalance", [account, "latest"])) as string);
  await signBuy.click();
  await expect(page.getByText("Buy confirmed")).toBeVisible({ timeout: 180_000 });
  const coin = await coinAddress(poolId);
  const coinAfterBuy = await balanceOf(coin, account);
  const whypeAfterBuy = await balanceOf(whype, account);
  const nativeAfterBuy = BigInt((await rpc("eth_getBalance", [account, "latest"])) as string);
  expect(coinAfterBuy > 0n).toBe(true);
  expect(whypeAfterBuy < whypeBefore || nativeAfterBuy < nativeBefore).toBe(true);

  await page.getByRole("tab", { name: "Sell" }).click();
  await page.getByRole("textbox", { name: /Amount/ }).fill("1");
  await page.waitForTimeout(400);
  if (await feeBox.isVisible()) await feeBox.check();
  const signSell = page.getByRole("button", { name: "Sign sell" });
  await expect(signSell).toBeEnabled({ timeout: 60_000 });
  await signSell.click();
  await expect(page.getByText("Sell confirmed")).toBeVisible({ timeout: 180_000 });
  const coinAfterSell = await balanceOf(coin, account);
  expect(coinAfterSell < coinAfterBuy).toBe(true);

  await fundAndPost(poolId, coin);
  await page.reload();
  const claim = page.getByRole("button", { name: "Claim", exact: true });
  await claim.scrollIntoViewIfNeeded();
  await expect(claim).toBeVisible({ timeout: 30_000 });
  await claim.click();
  await expect(page.getByText("Claim Kickback confirmed")).toBeVisible({ timeout: 120_000 });
  const afterClaim = await balanceOf(whype, account);
  expect(afterClaim > whypeAfterBuy).toBe(true);
  await page.getByRole("button", { name: "Claim failed credit" }).click();
  await expect(page.getByText("Claim failed credit confirmed")).toBeVisible({ timeout: 120_000 });
  const afterFailed = await balanceOf(whype, account);
  expect(afterFailed > afterClaim).toBe(true);
});

async function coinAddress(poolId: Hex): Promise<Address> {
  const configAbi = parseAbi(["function config(bytes32) view returns (address coin, address pair, bool coinIsToken0, uint8 mode, bool isPlatform, uint40 launchTime, address feeRecipient)"]);
  const data = encodeFunctionData({ abi: configAbi, functionName: "config", args: [poolId] });
  const raw = await call(hook, data);
  const decoded = decodeFunctionResult({ abi: configAbi, functionName: "config", data: raw }) as readonly [Address];
  return decoded[0];
}

async function fundAndPost(poolId: Hex, coin: Address): Promise<void> {
  const potsData = encodeFunctionData({ abi: hookAbi, functionName: "pots", args: [poolId] });
  const pots = decodeFunctionResult({ abi: hookAbi, functionName: "pots", data: await call(hook, potsData) }) as readonly bigint[];
  const pot = pots[2] ?? 0n;
  if (pot < 1_000_000n) throw new Error(`kickback pot is ${pot}`);
  const publisher = decodeFunctionResult({
    abi: kickAbi,
    functionName: "publisher",
    data: await call(distributor, encodeFunctionData({ abi: kickAbi, functionName: "publisher" })),
  }) as Address;
  await rpc("evm_increaseTime", [3700]);
  await rpc("evm_mine", []);
  await rpc("anvil_impersonateAccount", [publisher]);
  await rpc("anvil_setBalance", [publisher, word(10n ** 18n)]);
  const fund = encodeFunctionData({ abi: kickAbi, functionName: "fund", args: [poolId, pot] });
  const fundHash = (await rpc("eth_sendTransaction", [{ from: publisher, to: distributor, data: fund }])) as Hex;
  await rpc("evm_mine", []);
  const fundReceipt = (await rpc("eth_getTransactionReceipt", [fundHash])) as { status: string };
  if (fundReceipt.status !== "0x1") throw new Error("fund reverted");
  const epoch = BigInt(await call(distributor, encodeFunctionData({ abi: kickAbi, functionName: "nextEpoch", args: [poolId] })));
  const claimAmount = (pot * 90n) / 100n;
  const failedAmount = (pot * 5n) / 100n;
  const leaf = kickbackLeaf({
    chainId: 99801n,
    distributor,
    coin,
    pair: whype,
    epoch,
    account,
    amount: claimAmount,
  });
  const tree = buildTree([leaf]);
  const manifestHash = keccak256(toHex("seedix-e2e"));
  const post = encodeFunctionData({
    abi: kickAbi,
    functionName: "postRoot",
    args: [poolId, epoch, tree.root, manifestHash],
  });
  const postHash = (await rpc("eth_sendTransaction", [{ from: publisher, to: distributor, data: post }])) as Hex;
  await rpc("evm_mine", []);
  const postReceipt = (await rpc("eth_getTransactionReceipt", [postHash])) as { status: string };
  if (postReceipt.status !== "0x1") throw new Error("postRoot reverted");
  writeFileSync(
    `${manifestDir}/round.json`,
    JSON.stringify({
      poolId,
      epoch: epoch.toString(),
      chainId: 99801,
      distributor,
      coin,
      pair: whype,
      claims: [{ account, amount: claimAmount.toString() }],
    }),
  );
  const claimableSlot = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [account, keccak256(encodeAbiParameters([{ type: "uint64" }, { type: "bytes32" }], [epoch, mapSlot(poolId, 20n)]))],
    ),
  );
  await rpc("anvil_setStorageAt", [distributor, claimableSlot, word(failedAmount)]);
  const stored = BigInt(await call(distributor, encodeFunctionData({ abi: kickAbi, functionName: "claimable", args: [poolId, epoch, account] })));
  if (stored !== failedAmount) throw new Error(`claimable storage slot mismatch: ${stored}`);
  const epochSlot = keccak256(encodeAbiParameters([{ type: "uint64" }, { type: "bytes32" }], [epoch, mapSlot(poolId, 19n)]));
  await rpc("anvil_setStorageAt", [distributor, epochSlot, word(failedAmount)]);
  const liabilitySlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [whype, 17n]));
  const current = BigInt((await rpc("eth_getStorageAt", [distributor, liabilitySlot, "latest"])) as string);
  await rpc("anvil_setStorageAt", [distributor, liabilitySlot, word(current + failedAmount)]);
  await rpc("evm_increaseTime", [3700]);
  await rpc("evm_mine", []);
}
