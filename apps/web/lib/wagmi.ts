import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { elysiumTestnet } from "./chain";
import { walletConnectProjectId } from "./wallet";

const projectId = walletConnectProjectId(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID);

/** WalletConnect is offered only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is a real project id.
 *  An empty value or the example placeholder leaves the modal on injected wallets (MetaMask, Rabby).
 */
export const walletConnectEnabled = projectId.length > 0;

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
