import assert from "node:assert/strict";
import test from "node:test";
import { ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { launcherAbi, routerAbi } from "./abi.ts";
import { whypeAddress } from "./deployment.ts";
import { buildLaunchParams } from "./launch.ts";
import { amountSpecifiedFor, approvalForSwap, poolKey, swapLimit, tradeSteps, zeroForOne } from "./swap.ts";
import { deadlineFromNow, exactApproval, explainTxError, isRetryableTxError, parseDeadlineMinutes, runWithRetry } from "./tx.ts";

const coin = "0x00000000000000000000000000000000000000aa" as const;
const pair = "0x00000000000000000000000000000000000000bb" as const;
const hooks = "0x00000000000000000000000000000000000000cc" as const;
const wallet = "0x00000000000000000000000000000000000000dd" as const;

test("deadline defaults to ten minutes and rejects junk", () => {
  assert.equal(deadlineFromNow(10, 1_700_000_000), 1_700_000_600n);
  assert.equal(parseDeadlineMinutes("10").ok, true);
  assert.equal(parseDeadlineMinutes("").ok, false);
  assert.equal(parseDeadlineMinutes("0").ok, false);
  assert.equal(parseDeadlineMinutes("61").ok, false);
  assert.equal(parseDeadlineMinutes("1.5").ok, false);
});

test("approvals are the exact amount", () => {
  assert.equal(exactApproval(123n), 123n);
  assert.throws(() => exactApproval(2n ** 256n - 1n), /unlimited/);
  assert.equal(approvalForSwap("exactIn", 50n, 40n, 1), 50n);
  assert.equal(approvalForSwap("exactOut", 40n, 50n, 1), 51n);
});

test("swap limit is minOut or maxIn", () => {
  assert.equal(swapLimit("exactIn", 1_000n, 1), 990n);
  assert.equal(swapLimit("exactOut", 1_000n, 1), 1_010n);
  assert.equal(amountSpecifiedFor("exactIn", 5n), -5n);
  assert.equal(amountSpecifiedFor("exactOut", 5n), 5n);
});

test("buy and sell direction follows token order", () => {
  const built = poolKey(coin, pair, hooks);
  assert.equal(built.coinIsToken0, true);
  assert.equal(built.key.currency0, coin);
  assert.equal(built.key.fee, 1000);
  assert.equal(built.key.tickSpacing, 60);
  assert.equal(zeroForOne("buy", true), false);
  assert.equal(zeroForOne("sell", true), true);
  const flipped = poolKey(pair, coin, hooks);
  assert.equal(flipped.coinIsToken0, false);
});

test("launch params match the launcher struct", () => {
  const params = buildLaunchParams({
    name: "North star",
    symbol: "NSTR",
    pair,
    mode: "kickback",
    feeRecipient: wallet,
    teamPercent: 5,
    connected: wallet,
    startMcapInPair: 20_000n * 10n ** 18n,
  });
  assert.equal(params.name, "North star");
  assert.equal(params.symbol, "NSTR");
  assert.equal(params.mode, 1);
  assert.equal(params.teamBps, 500);
  assert.equal(params.teamWallet, wallet);
  assert.equal(params.feeRecipient, wallet);
  assert.equal("metadataUri" in params, false);
  const noTeam = buildLaunchParams({
    name: "North star",
    symbol: "NSTR",
    pair,
    mode: "burn",
    feeRecipient: wallet,
    teamPercent: 0,
    connected: wallet,
    startMcapInPair: 1n,
  });
  assert.equal(noTeam.mode, 2);
  assert.equal(noTeam.teamWallet, "0x0000000000000000000000000000000000000000");
});

test("a trade wraps the shortfall and approves only the exact spend", () => {
  const built = poolKey(coin, pair, hooks);
  const builtSteps = tradeSteps({
    action: "Buy",
    kind: "exactIn",
    spendToken: whypeAddress,
    spendLabel: "WHYPE",
    key: built.key,
    zeroForOne: false,
    typedAmount: 5n,
    quoted: 9n,
    slippagePct: 1,
    deadline: 100n,
    allowance: 1n,
    tokenBalance: 2n,
    nativeBalance: 10n,
  });
  assert.ok("steps" in builtSteps);
  if (!("steps" in builtSteps)) return;
  assert.equal(builtSteps.steps[0]?.functionName, "deposit");
  assert.equal(builtSteps.steps[0]?.value, 3n);
  assert.deepEqual(builtSteps.steps[1]?.args?.[1], 5n);
  assert.notEqual(builtSteps.steps[1]?.args?.[1], 2n ** 256n - 1n);
  const swap = builtSteps.steps[2]?.args;
  assert.equal(swap?.[2], -5n);
  assert.equal(swap?.[3], 8n);
  assert.equal(swap?.[4], 100n);
  const funded = tradeSteps({
    action: "Buy",
    kind: "exactIn",
    spendToken: whypeAddress,
    spendLabel: "WHYPE",
    key: built.key,
    zeroForOne: false,
    typedAmount: 5n,
    quoted: 9n,
    slippagePct: 1,
    deadline: 100n,
    allowance: 5n,
    tokenBalance: 5n,
    nativeBalance: 10n,
  });
  assert.ok("steps" in funded);
  if ("steps" in funded) {
    assert.equal(funded.steps.length, 1);
    assert.equal(funded.steps[0]?.functionName, "swap");
  }
});

test("error mapping decodes custom errors and wallet failures", async () => {
  const data = encodeErrorResult({ abi: routerAbi, errorName: "TooLittleReceived" });
  const reverted = new ContractFunctionRevertedError({ abi: routerAbi, data, functionName: "swap" });
  assert.match(explainTxError(reverted), /quoted minimum/);
  const paused = new ContractFunctionRevertedError({
    abi: launcherAbi,
    data: encodeErrorResult({ abi: launcherAbi, errorName: "PairNotAllowed" }),
    functionName: "launch",
  });
  assert.match(explainTxError(paused), /not allowed/);
  assert.match(explainTxError(new Error("user rejected the request")), /rejected the request/);
  assert.match(explainTxError(new Error("insufficient funds for gas * price + value")), /enough HYPE/);
  const mislabeled = new Error('function swap(uint160 sqrtPriceLimitX96) reverted');
  (mislabeled as { data?: string }).data = "0x7c9c6e8f0000000000000000000000000000000000000000000c184c1135aba4eaa68ea000000000000000000000000000000000000000000000000000000001000276a4";
  assert.doesNotMatch(explainTxError(mislabeled), /price limit stopped/i);
  assert.match(explainTxError(mislabeled), /price bound/i);
  const priceLimit = new ContractFunctionRevertedError({
    abi: routerAbi,
    data: encodeErrorResult({ abi: routerAbi, errorName: "PriceLimit" }),
    functionName: "swap",
  });
  assert.match(explainTxError(priceLimit), /price limit stopped/i);
  assert.doesNotMatch(explainTxError(new Error("execution reverted: out of gas inside the hook")), /enough HYPE/i);
  assert.equal(explainTxError(new Error("429 Rate Limit Exceeded")), "The network is busy, try again.");
  assert.equal(isRetryableTxError(new Error("429 Rate Limit Exceeded")), true);
  assert.equal(isRetryableTxError(new Error("request timed out")), true);
  assert.equal(isRetryableTxError(new Error("ERC20: insufficient allowance")), true);
  assert.equal(isRetryableTxError(priceLimit), false);
  let calls = 0;
  const value = await runWithRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("429 Rate Limit Exceeded");
      return "ok";
    },
    [1, 1, 1],
    async () => {},
  );
  assert.equal(value, "ok");
  assert.equal(calls, 3);
  assert.match(explainTxError(new Error("ERC20: transfer amount exceeds balance")), /enough of this token/);
  assert.match(explainTxError(new Error("chain mismatch")), /wrong network/);
  const blank = new Error('The contract function "swap" reverted with the following reason:\n');
  assert.match(explainTxError(blank), /did not go through/);
  assert.equal(isRetryableTxError(blank), true);
  const named = new Error('The contract function "swap" reverted with the following reason:\nTooLittleReceived');
  assert.match(explainTxError(named), /quoted minimum/);
  assert.equal(isRetryableTxError(named), false);
  assert.match(explainTxError({ data: { errorName: "NotEnoughLiquidity" }, shortMessage: "reverted" }), /enough liquidity/);
});
