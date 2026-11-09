"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { elysiumTestnet } from "@/lib/chain";

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const injected = connectors[0];

  if (!isConnected) {
    return (
      <button className="wallet" type="button" disabled={!injected || isPending} onClick={() => injected && connect({ connector: injected })}>
        {isPending ? "Connecting" : "Connect wallet"}
      </button>
    );
  }

  if (chainId !== elysiumTestnet.id) {
    return (
      <button className="wallet" type="button" onClick={() => switchChain({ chainId: elysiumTestnet.id })}>
        Switch to 99801
      </button>
    );
  }

  const short = `${address?.slice(0, 6)}…${address?.slice(-4)}`;
  return (
    <button className="wallet" type="button" onClick={() => disconnect()}>
      {short}
    </button>
  );
}
