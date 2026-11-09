"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { elysiumTestnet } from "@/lib/chain";
import { Button } from "@/components/ui/Button";

export function NoWalletHelp() {
  return (
    <div className="status" data-tone="error" role="alert">
      <strong>No wallet in this browser</strong>
      <p className="note">Install a browser wallet, then reload this page. Seedix connects on Elysium testnet (99801).</p>
      <a className="text-link" href="https://metamask.io/download/">Install MetaMask</a>
    </div>
  );
}

function walletInstalled(): boolean {
  return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
}

export function WalletButton({ forceHelp = false, prominent = false }: { forceHelp?: boolean; prominent?: boolean }) {
  const [help, setHelp] = useState(forceHelp);

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted) {
          return (
            <Button variant={prominent ? "accent" : "secondary"} block={prominent} type="button" disabled>
              <span className="wide">Connect wallet</span>
              <span className="narrow">Connect</span>
            </Button>
          );
        }

        if (!account) {
          return (
            <div className="wallet-help">
              <Button
                variant={prominent ? "accent" : "secondary"}
                block={prominent}
                type="button"
                onClick={() => {
                  if (!walletInstalled()) {
                    setHelp(true);
                    return;
                  }
                  openConnectModal();
                }}
              >
                <span className="wide">Connect wallet</span>
                <span className="narrow">Connect</span>
              </Button>
              {help ? <NoWalletHelp /> : null}
            </div>
          );
        }

        if (chain?.unsupported || chain?.id !== elysiumTestnet.id) {
          return (
            <Button variant="secondary" type="button" onClick={openChainModal}>
              <span className="wide">Switch to Elysium testnet</span>
              <span className="narrow">Switch</span>
            </Button>
          );
        }

        return (
          <Button variant="secondary" type="button" onClick={openAccountModal}>
            {account.displayName}
          </Button>
        );
      }}
    </ConnectButton.Custom>
  );
}
