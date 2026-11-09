"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { elysiumTestnet } from "@/lib/chain";
import { Button } from "@/components/ui/Button";

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const injected = connectors[0];

  if (!isConnected) {
    return (
      <Button
        variant="secondary"
        type="button"
        disabled={!injected || isPending}
        title={injected ? "Connect an injected wallet" : "No injected wallet in this browser"}
        onClick={() => injected && connect({ connector: injected })}
      >
        {isPending ? (
          "Connecting"
        ) : injected ? (
          <>
            <span className="wide">Connect wallet</span>
            <span className="narrow">Connect</span>
          </>
        ) : (
          "No wallet"
        )}
      </Button>
    );
  }

  if (chainId !== elysiumTestnet.id) {
    return (
      <Button variant="secondary" type="button" onClick={() => switchChain({ chainId: elysiumTestnet.id })}>
        <span className="wide">Switch to Elysium testnet</span>
        <span className="narrow">Switch</span>
      </Button>
    );
  }

  const short = `${address?.slice(0, 6)}…${address?.slice(-4)}`;
  return (
    <Button variant="secondary" type="button" onClick={() => disconnect()}>
      {short}
    </Button>
  );
}
