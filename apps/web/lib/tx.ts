import {
  ContractFunctionRevertedError,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { priorityFloorWei, transactionFees, type TxFees } from "@seedix/shared";
import { actionAbis } from "./abi";
import { elysiumTestnet } from "./chain";
import { MAX_UINT256 } from "./protocol";

export const DEFAULT_DEADLINE_MINUTES = 10;

export type TxStatus = "idle" | "awaiting_signature" | "pending" | "confirmed" | "failed";

export type TxState = {
  status: TxStatus;
  action?: string;
  hash?: Hex;
  message?: string;
};

export type TxStep = {
  action: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
};

const revertCopy: Record<string, string> = {
  Expired: "The deadline passed before the transaction was mined.",
  TooLittleReceived: "This trade would receive less than the quoted minimum. Raise slippage or try a smaller amount.",
  PartialFill: "The pool could not take the full amount, so the trade was not sent.",
  TooMuchRequested: "This trade would cost more than the quoted maximum. Lower the size or raise slippage.",
  PriceLimit: "The price limit stopped the trade before it filled. Try a smaller amount.",
  BadArgs: "The launch details were rejected. Check the name, ticker, team share, and starting cap.",
  PairNotAllowed: "That pair token is not allowed on this deployment.",
  BadRecipient: "The fee recipient cannot be the zero address, the dead address, or the fee wallet.",
  Paused: "Launches are paused.",
  RateLimited: "The launch rate limit has been reached. Try again later.",
  UnsafePair: "That pair token cannot be used for a launch.",
  PairRefused: "That pair token is refused.",
  KickbackNeedsVetted: "Kickback is only available for a vetted pair. Choose Keep or Burn, or pick a vetted pair.",
  RouteNotReady: "That pair does not have a WHYPE route yet.",
  FeeOnTransfer: "That token takes a fee on transfer, so it cannot be a pair.",
  NotCreator: "Only the launcher of this coin can pin its metadata.",
  BadCid: "The metadata id must be 10 to 128 letters and numbers.",
  BadProof: "The Kickback proof does not match this round.",
  AlreadyClaimed: "This Kickback round was already claimed.",
  Nothing: "There is no failed-transfer credit to claim.",
  Excluded: "This account is excluded from Kickback.",
  ReviewOpen: "The review window is still open. Claim opens after it closes.",
  Sealed: "This Kickback round is sealed.",
  Dust: "The Kickback amount is below the dust threshold.",
  Cap: "The Kickback amount is above the round cap.",
  BadEpoch: "That Kickback round is not open.",
  TransferFailed: "The token transfer failed.",
  InsufficientBalance: "The wallet does not have enough of this token.",
  InsufficientAllowance: "The router is not approved for this amount.",
  Locked: "The hook is busy with another swap. Try again.",
  SwapDuringLaunch: "The pool is still opening. Wait a moment and try again.",
  UnknownPool: "This pool is not on the launch hook.",
  Overflow: "That amount is too large for this pool.",
  SafeCastOverflow: "That amount is too large for this pool.",
  PriceLimitAlreadyExceeded: "The swap price bound does not match this pool. Refresh the page and try again.",
  PriceLimitOutOfBounds: "The swap price bound does not match this pool. Refresh the page and try again.",
  NotEnoughLiquidity: "This pool does not have enough liquidity for that size.",
  ERC20InsufficientAllowance: "The router is not approved for this amount.",
  ERC20InsufficientBalance: "The wallet does not have enough of this token.",
};

const EMPTY_SWAP = "The swap did not go through. Raise slippage or try a smaller amount. If you just approved, wait a moment and try again.";

export function messageForRevert(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const key = name.split("(")[0]?.trim() ?? name;
  if (revertCopy[key]) return revertCopy[key];
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `The contract reverted with ${key}.`;
  const text = name.replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function errorNameOf(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as { data?: unknown; errorName?: string; reason?: string };
  if (typeof record.errorName === "string" && record.errorName && record.errorName !== "Error" && record.errorName !== "Panic") {
    return record.errorName;
  }
  if (record.data && typeof record.data === "object") {
    const name = (record.data as { errorName?: string }).errorName;
    if (name && name !== "Error" && name !== "Panic") return name;
  }
  if (typeof record.reason === "string" && record.reason.trim()) return record.reason.trim();
  return undefined;
}

/** viem puts the revert name on the line after this sentence, which the old parser dropped. */
function reasonLines(err: unknown): string[] {
  return briefText(err)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function reasonAfterTemplate(err: unknown): string | undefined {
  const lines = reasonLines(err);
  const index = lines.findIndex((line) => /reverted with the following reason:?$/i.test(line));
  if (index < 0) return undefined;
  return lines[index + 1];
}

export function parseDeadlineMinutes(raw: string): { ok: true; minutes: number } | { ok: false; message: string } {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { ok: false, message: "Deadline must be a whole number of minutes." };
  const minutes = Number(text);
  if (minutes < 1) return { ok: false, message: "Deadline must be at least 1 minute." };
  if (minutes > 60) return { ok: false, message: "Deadline cannot be above 60 minutes." };
  return { ok: true, minutes };
}

export function deadlineFromNow(minutes: number, nowSec: number): bigint {
  const parsed = parseDeadlineMinutes(String(minutes));
  if (!parsed.ok) throw new Error(parsed.message);
  return BigInt(nowSec) + BigInt(parsed.minutes) * 60n;
}

/** The exact amount the router may pull. Never the unlimited allowance. */
export function exactApproval(amount: bigint): bigint {
  if (amount <= 0n) throw new Error("Enter a token amount.");
  if (amount >= MAX_UINT256) throw new Error("Approval cannot be unlimited.");
  return amount;
}

function causes(err: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return out;
}

function errorText(err: unknown): string {
  return causes(err)
    .map((item) => {
      const record = item as { shortMessage?: string; message?: string; details?: string };
      return [record.shortMessage, record.message, record.details].filter(Boolean).join("\n");
    })
    .join("\n");
}

export function isUserRejection(err: unknown): boolean {
  if (causes(err).some((item) => (item as { name?: string }).name === "UserRejectedRequestError")) return true;
  return /user rejected|user denied|rejected the request|denied transaction signature/i.test(errorText(err));
}

function revertName(err: unknown): string | undefined {
  for (const item of causes(err)) {
    const named = errorNameOf(item);
    if (named) return named.split("(")[0]?.trim() || named;
    if (item instanceof ContractFunctionRevertedError) {
      const name = item.data?.errorName;
      if (name && name !== "Error" && name !== "Panic") return name;
    }
  }
  const trailed = reasonAfterTemplate(err);
  if (trailed && /^[A-Za-z_][A-Za-z0-9_]*(\(.*\))?$/.test(trailed)) return trailed.split("(")[0];
  return undefined;
}

function emptyRevert(err: unknown): boolean {
  const lines = reasonLines(err);
  const index = lines.findIndex((line) => /reverted with the following reason:?$/i.test(line));
  if (index >= 0 && !lines[index + 1] && !revertName(err)) return true;
  for (const item of causes(err)) {
    const data = (item as { data?: unknown }).data;
    if (data === "0x") return true;
  }
  return false;
}

/** First 4 bytes of revert data. Matched exactly, never as a substring of the ABI dump. */
function revertSelector(err: unknown): string | undefined {
  for (const item of causes(err)) {
    const data = (item as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]{8}/.test(data)) return data.slice(0, 10).toLowerCase();
  }
  return undefined;
}

function briefText(err: unknown): string {
  const first = causes(err)[0] as { shortMessage?: string; message?: string } | undefined;
  return [first?.shortMessage, first?.message].filter(Boolean).join("\n");
}

export function explainTxError(err: unknown): string {
  if (isUserRejection(err)) return "You rejected the request in your wallet. Nothing was sent.";
  const decoded = messageForRevert(revertName(err) ?? reasonAfterTemplate(err));
  if (decoded) return decoded;
  if (emptyRevert(err)) return EMPTY_SWAP;
  const selector = revertSelector(err);
  if (selector === "0x4b3eeb24") return revertCopy.PriceLimit;
  if (selector === "0x7c9c6e8f" || selector === "0x9e4d7cc7") {
    return "The swap price bound does not match this pool. Refresh the page and try again.";
  }
  if (selector === "0x7a5ed734") return "This pool does not have enough liquidity for that size.";
  if (selector && selectorCopy[selector]) return selectorCopy[selector];
  const blob = errorText(err);
  if (/rate limit|too many requests|\b429\b/i.test(blob)) return "The network is busy, try again.";
  const brief = briefText(err);
  if (/chain mismatch|wrong network|wrong chain|not configured for chain|does not match the target chain/i.test(brief)) {
    return `The wallet is on the wrong network. Switch to Elysium testnet (${elysiumTestnet.id}).`;
  }
  if (/insufficient funds for gas \* price \+ value|exceeds the balance of the account/i.test(brief)) {
    return "The wallet does not have enough HYPE to cover this transaction and its gas.";
  }
  if (/max fee per gas less than block base fee/i.test(`${brief}\n${blob}`)) {
    return "Network fee moved, please try again.";
  }
  if (/insufficient allowance/i.test(brief)) return "The router is not approved for this amount.";
  if (/transfer amount exceeds balance|insufficient balance/i.test(brief)) {
    return "The wallet does not have enough of this token.";
  }
  if (/HttpRequestError|TimeoutError|RpcRequestError|failed to fetch|network request failed|Invalid parameters were provided to the RPC/i.test(brief)) {
    return "The network request failed. Check the RPC and try again.";
  }
  const line =
    brief.split("\n").find((item) => {
      const text = item.trim();
      return text.length > 0 && !item.includes("Contract Call:") && !/reverted with the following reason:?$/i.test(text);
    }) ?? "The transaction failed.";
  const short = line.replace(/\s+/g, " ").trim();
  return short.length > 160 ? `${short.slice(0, 160)}…` : short;
}

const selectorOf = (signature: string): string => keccak256(toBytes(signature)).slice(0, 10);

const selectorCopy: Record<string, string> = {
  [selectorOf("PriceLimit()")]: revertCopy.PriceLimit ?? "",
  [selectorOf("Expired()")]: revertCopy.Expired ?? "",
  [selectorOf("TooLittleReceived()")]: revertCopy.TooLittleReceived ?? "",
  [selectorOf("TooMuchRequested()")]: revertCopy.TooMuchRequested ?? "",
  [selectorOf("PriceLimitAlreadyExceeded(uint160,uint160)")]: "The swap price bound does not match this pool. Refresh the page and try again.",
  [selectorOf("PriceLimitOutOfBounds(uint160)")]: "The swap price bound does not match this pool. Refresh the page and try again.",
  [selectorOf("NotEnoughLiquidity(bytes32)")]: "This pool does not have enough liquidity for that size.",
  [selectorOf("SafeCastOverflow()")]: "That amount is too large for this pool.",
  [selectorOf("SwapDuringLaunch()")]: "The pool is still opening. Wait a moment and try again.",
  [selectorOf("UnknownPool()")]: "This pool is not on the launch hook.",
  [selectorOf("Locked()")]: "The hook is busy with another swap. Try again.",
};

/** 429s, transport failures, and an allowance read that has not caught up with the approve receipt. */
export function isRetryableTxError(err: unknown): boolean {
  if (isUserRejection(err)) return false;
  const name = revertName(err);
  if (name === "PriceLimit" || name === "TooLittleReceived" || name === "TooMuchRequested" || name === "Expired") return false;
  if (name === "ERC20InsufficientAllowance" || name === "InsufficientAllowance") return true;
  if (emptyRevert(err)) return true;
  const blob = `${briefText(err)}\n${errorText(err)}`;
  if (/rate limit|too many requests|\b429\b/i.test(blob)) return true;
  if (/timeout|timed out|network request failed|failed to fetch|ECONNRESET|ETIMEDOUT|HttpRequestError|TimeoutError/i.test(blob)) return true;
  if (/max fee per gas less than block base fee/i.test(blob)) return true;
  if (/insufficient allowance/i.test(blob)) return true;
  const selector = revertSelector(err);
  return selector === selectorOf("ERC20InsufficientAllowance(address,uint256,uint256)");
}

export async function runWithRetry<T>(
  fn: () => Promise<T>,
  waits: readonly number[],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= waits.length || !isRetryableTxError(err)) throw err;
      await sleep(waits[attempt] ?? 0);
      attempt += 1;
    }
  }
}

const retryWaits = [300, 800, 1600];

async function feeOverrides(publicClient: PublicClient): Promise<TxFees> {
  const block = await publicClient.getBlock();
  const priorityFloor = priorityFloorWei(process.env.NEXT_PUBLIC_PRIORITY_FEE_WEI);
  if (block.baseFeePerGas == null) {
    const legacyGasPrice = await publicClient.getGasPrice();
    return transactionFees({ baseFeePerGas: null, legacyGasPrice, priorityFloor });
  }
  let rpcTip = 0n;
  try {
    rpcTip = await publicClient.estimateMaxPriorityFeePerGas();
  } catch {
    rpcTip = 0n;
  }
  return transactionFees({ baseFeePerGas: block.baseFeePerGas, rpcTip, priorityFloor });
}

type ChainRequest = {
  request: (args: { method: "wallet_addEthereumChain"; params: readonly [Record<string, unknown>] }) => Promise<unknown>;
};

export async function ensureElysiumChain(input: {
  currentChainId: number | undefined;
  target?: Chain;
  switchChain: (chainId: number) => Promise<unknown>;
  wallet: ChainRequest | undefined;
}): Promise<void> {
  const target = input.target ?? elysiumTestnet;
  if (input.currentChainId === target.id) return;
  const add = async () => {
    if (!input.wallet) throw new Error(`The wallet is on the wrong network. Switch to Elysium testnet (${target.id}).`);
    const rpc = target.rpcUrls.default.http[0];
    if (!rpc) throw new Error("The Elysium RPC is not configured.");
    await input.wallet.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${target.id.toString(16)}`,
          chainName: target.name,
          nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
          rpcUrls: [rpc],
          blockExplorerUrls: target.blockExplorers?.default.url ? [target.blockExplorers.default.url] : [],
        },
      ],
    });
  };
  try {
    await input.switchChain(target.id);
  } catch (err) {
    if (isUserRejection(err)) throw err;
    await add();
    await input.switchChain(target.id);
  }
}

export async function sendContractSteps(input: {
  steps: readonly TxStep[];
  account: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
  onState: (state: TxState) => void;
}): Promise<TransactionReceipt | null> {
  let last: TransactionReceipt | null = null;
  for (const step of input.steps) {
    let hash: Hex | undefined;
    try {
      const simulated = await runWithRetry(async () => {
        try {
          return await input.publicClient.simulateContract({
            address: step.address,
            abi: step.abi,
            functionName: step.functionName,
            args: step.args,
            account: input.account,
            value: step.value,
          });
        } catch (err) {
          if (isRetryableTxError(err)) {
            input.onState({ status: "pending", action: step.action, message: "Network busy, retrying…" });
          }
          throw err;
        }
      }, retryWaits);
      input.onState({ status: "awaiting_signature", action: step.action });
      const fees = await feeOverrides(input.publicClient);
      const request = {
        ...simulated.request,
        ...("gasPrice" in fees
          ? { type: "legacy" as const, gasPrice: fees.gasPrice, maxFeePerGas: undefined, maxPriorityFeePerGas: undefined }
          : { type: "eip1559" as const, ...fees, gasPrice: undefined }),
      };
      hash = await input.walletClient.writeContract(request as Parameters<WalletClient["writeContract"]>[0]);
      input.onState({ status: "pending", action: step.action, hash });
      const receipt = await input.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        input.onState({
          status: "failed",
          action: step.action,
          hash,
          message: "The transaction was mined and then reverted.",
        });
        return null;
      }
      input.onState({ status: "confirmed", action: step.action, hash });
      last = receipt;
    } catch (err) {
      input.onState({ status: "failed", action: step.action, hash, message: explainTxError(err) });
      return null;
    }
  }
  return last;
}

export function isWrongChainMessage(message: string): boolean {
  return message.startsWith("The wallet is on the wrong network.");
}
