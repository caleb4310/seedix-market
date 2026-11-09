"use client";

import { useCallback, useState } from "react";
import type { Address, Hex, PublicClient, TransactionReceipt, WalletClient } from "viem";
import { getAccount, getPublicClient, getWalletClient, switchChain } from "wagmi/actions";
import { elysiumTestnet } from "./chain";
import { ensureElysiumChain, explainTxError, sendContractSteps, type TxState, type TxStep } from "./tx";
import { wagmiConfig } from "./wagmi";

const idle: TxState = { status: "idle" };

export function useContractTx() {
  const [state, setState] = useState<TxState>(idle);

  const reset = useCallback(() => setState(idle), []);

  const ensureChain = useCallback(async () => {
    const account = getAccount(wagmiConfig);
    const current = account.chainId;
    const walletClient =
      current === undefined ? undefined : await getWalletClient(wagmiConfig, { chainId: current }).catch(() => undefined);
    await ensureElysiumChain({
      currentChainId: current,
      switchChain: (chainId) => switchChain(wagmiConfig, { chainId }),
      wallet: walletClient
        ? { request: (args) => walletClient.request(args as never) }
        : undefined,
    });
  }, []);

  const send = useCallback(async (steps: readonly TxStep[]): Promise<TransactionReceipt | null> => {
    const account = getAccount(wagmiConfig);
    if (!account.address) {
      setState({ status: "failed", message: "Connect a wallet to continue." });
      return null;
    }
    const publicClient = getPublicClient(wagmiConfig, { chainId: elysiumTestnet.id });
    if (!publicClient) {
      setState({ status: "failed", message: "The Elysium RPC is not configured." });
      return null;
    }
    try {
      await ensureChain();
    } catch (err) {
      setState({ status: "failed", message: explainTxError(err) });
      return null;
    }
    const walletClient = await getWalletClient(wagmiConfig, { chainId: elysiumTestnet.id }).catch(() => undefined);
    if (!walletClient) {
      setState({ status: "failed", message: `The wallet is on the wrong network. Switch to Elysium testnet (${elysiumTestnet.id}).` });
      return null;
    }
    return sendContractSteps({
      steps,
      account: account.address,
      publicClient: publicClient as PublicClient,
      walletClient: walletClient as WalletClient,
      onState: setState,
    });
  }, [ensureChain]);

  return { state, send, reset, ensureChain };
}

export type { Address, Hex };
