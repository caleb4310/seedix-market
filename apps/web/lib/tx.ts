import {
  ContractFunctionRevertedError,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
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
};

export function messageForRevert(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return revertCopy[name] ?? `The contract reverted with ${name}.`;
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
    if (item instanceof ContractFunctionRevertedError) {
      const name = item.data?.errorName;
      if (name && name !== "Error" && name !== "Panic") return name;
      if (typeof item.reason === "string" && item.reason.length > 0 && revertCopy[item.reason]) return item.reason;
    }
    const data = (item as { data?: { errorName?: string } }).data;
    if (data?.errorName && data.errorName !== "Error" && data.errorName !== "Panic") return data.errorName;
  }
  const text = errorText(err);
  for (const name of Object.keys(revertCopy)) {
    if (text.includes(name)) return name;
  }
  return undefined;
}

export function explainTxError(err: unknown): string {
  if (isUserRejection(err)) return "You rejected the request in your wallet. Nothing was sent.";
  const decoded = messageForRevert(revertName(err));
  if (decoded) return decoded;
  const text = errorText(err);
  if (/chain mismatch|wrong network|wrong chain|not configured for chain|does not match the target chain/i.test(text)) {
    return `The wallet is on the wrong network. Switch to Elysium testnet (${elysiumTestnet.id}).`;
  }
  if (/insufficient funds for gas|intrinsic gas too low|gas required exceeds|out of gas|max fee per gas less than block base fee/i.test(text)) {
    return "The wallet does not have enough HYPE to pay for gas.";
  }
  if (/exceeds balance|insufficient balance|transfer amount exceeds balance|ERC20: transfer amount exceeds balance/i.test(text)) {
    return "The wallet does not have enough of this token.";
  }
  if (/HttpRequestError|TimeoutError|RpcRequestError|failed to fetch|network request failed|Invalid parameters were provided to the RPC/i.test(text)) {
    return "The network request failed. Check the RPC and try again.";
  }
  const line = text.split("\n").find((item) => item.trim().length > 0) ?? "The transaction failed.";
  return line.length > 220 ? `${line.slice(0, 220)}…` : line;
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
      const simulated = await input.publicClient.simulateContract({
        address: step.address,
        abi: step.abi,
        functionName: step.functionName,
        args: step.args,
        account: input.account,
        value: step.value,
      });
      input.onState({ status: "awaiting_signature", action: step.action });
      hash = await input.walletClient.writeContract(simulated.request);
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
