import { decodeEventLog, type Address, type Hex, type TransactionReceipt } from "viem";
import { getAccount, getPublicClient } from "wagmi/actions";
import { erc20Abi, launcherAbi, launcherLegacyAbi, quoterAbi } from "./abi";
import { appChain } from "./chain";
import { quoterAddress, routerAddress } from "./deployment";
import { quoteParams, quotedAmount, type PoolKey, type SwapKind } from "./swap";
import { wagmiConfig } from "./wagmi";

function client() {
  const publicClient = getPublicClient(wagmiConfig, { chainId: appChain.id });
  if (!publicClient) throw new Error("The RPC is not configured.");
  return publicClient;
}

export async function freshQuote(input: {
  kind: SwapKind;
  key: PoolKey;
  zeroForOne: boolean;
  amount: bigint;
}): Promise<bigint> {
  const account = getAccount(wagmiConfig).address;
  const simulated = await client().simulateContract({
    address: quoterAddress,
    abi: quoterAbi,
    functionName: input.kind === "exactIn" ? "quoteExactInputSingle" : "quoteExactOutputSingle",
    args: [quoteParams(input.key, input.zeroForOne, input.amount)],
    account: account ?? "0x0000000000000000000000000000000000000001",
  });
  const amount = quotedAmount(simulated.result);
  if (amount === undefined) throw new Error("The quoter did not return a price.");
  return amount;
}

export async function spendState(token: Address, owner: Address): Promise<{ balance: bigint; allowance: bigint; native: bigint }> {
  const publicClient = client();
  const [balance, allowance, native] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, routerAddress] }),
    publicClient.getBalance({ address: owner }),
  ]);
  return { balance: balance as bigint, allowance: allowance as bigint, native };
}

export async function tokenDecimals(token: Address): Promise<number> {
  const decimals = await client().readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
  return Number(decimals);
}

function coinFromLog(abi: typeof launcherAbi, log: TransactionReceipt["logs"][number]) {
  const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
  if (decoded.eventName !== "CoinLaunched") return undefined;
  const args = decoded.args as { poolId?: Hex; coin?: Address; pair?: Address };
  if (!args.poolId || !args.coin || !args.pair) return undefined;
  return { poolId: args.poolId, coin: args.coin, pair: args.pair };
}

/** New deployments append category and pair status. Older logs use the shorter event. */
export function launchedCoin(receipt: TransactionReceipt): { poolId: Hex; coin: Address; pair: Address } | undefined {
  for (const log of receipt.logs) {
    try {
      const next = coinFromLog(launcherAbi, log);
      if (next) return next;
    } catch {
      try {
        const legacy = coinFromLog(launcherLegacyAbi, log);
        if (legacy) return legacy;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}
