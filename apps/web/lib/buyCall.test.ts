import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, encodeAbiParameters, http, keccak256, type Address, type Hex } from "viem";
import { hookConfigAbi, routerAbi } from "./abi.ts";
import { extremeSqrtPriceLimit } from "./amounts.ts";
import { poolKey, zeroForOne } from "./swap.ts";

const rpc = "https://testnet-rpc.elysium.kinetiq.xyz";
const hook = "0x63d00d49F9152ce677cf0E2A211dFa5498eE28cc" as Address;
const router = "0x565317e11D843310A4B51E6D15fb60a3233D66D8" as Address;
const whype = "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234" as Address;
const buyer = "0x000000000000000000000000000000000000bEEF" as Address;
const freshPool = "0x2bc971122087d7ea96ff615d9c1ad5469f20eb4a4227e0943c90f727311b4614" as Hex;
const olderPool = "0x9d58e21b5773e32d9dbee80b93aa1021e726f8a28260e14796c450a1310385fa" as Hex;
const freshBlock = 27156822n;
const amount = 200000000000000000n;

function mapSlot(key: Address, slot: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key, slot]));
}

function whypeOverride(): { address: Address; stateDiff: { slot: Hex; value: Hex }[] } {
  const word = `0x${amount.toString(16).padStart(64, "0")}` as Hex;
  const balance = mapSlot(buyer, 51n);
  const allowance = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [router, BigInt(mapSlot(buyer, 52n))]));
  return { address: whype, stateDiff: [{ slot: balance, value: word }, { slot: allowance, value: word }] };
}

async function buy(pool: Hex, blockNumber?: bigint) {
  const client = createPublicClient({ transport: http(rpc) });
  const cfg = await client.readContract({
    address: hook,
    abi: hookConfigAbi,
    functionName: "config",
    args: [pool],
    blockNumber,
  });
  const coin = cfg[0];
  const pair = cfg[1];
  assert.equal(pair.toLowerCase(), whype.toLowerCase());
  const { key } = poolKey(coin, pair, hook);
  const dir = zeroForOne("buy", Boolean(cfg[2]));
  const limit = extremeSqrtPriceLimit(dir);
  const block = blockNumber ? await client.getBlock({ blockNumber }) : await client.getBlock();
  const sim = await client.simulateContract({
    address: router,
    abi: routerAbi,
    functionName: "swap",
    args: [key, dir, -amount, 0n, block.timestamp + 600n, limit],
    account: buyer,
    blockNumber,
    stateOverride: [whypeOverride()],
  });
  assert.equal(typeof sim.result, "bigint");
}

test("a 0.2 HYPE buy clears on a fresh coin and an older one", async () => {
  await buy(freshPool, freshBlock);
  await buy(olderPool);
});
