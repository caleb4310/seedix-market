import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { elysiumTestnet } from "./chain";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

/** WalletConnect, Rainbow, and MetaMask's remote path need a project id. Without one, only injected wallets are offered. */
export const walletConnectProjectId = projectId;

const wallets = projectId
  ? [injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet]
  : [injectedWallet];

export const wagmiConfig = createConfig({
  chains: [elysiumTestnet],
  connectors: connectorsForWallets([{ groupName: "Wallets", wallets }], {
    appName: "Seedix",
    projectId: projectId || "seedix-injected-only",
  }),
  transports: {
    [elysiumTestnet.id]: http(elysiumTestnet.rpcUrls.default.http[0]),
  },
  ssr: true,
});
