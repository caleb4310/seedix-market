import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, fallback, http } from "wagmi";
import { elysiumTestnet, rpcUrlList } from "./chain";
import { walletConnectProjectId } from "./wallet";

const projectId = walletConnectProjectId(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID);

/** WalletConnect is offered only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is a real project id.
 *  An empty value or the example placeholder leaves the modal on injected wallets (MetaMask, Rabby).
 */
export const walletConnectEnabled = projectId.length > 0;

const wallets = projectId
  ? [injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet]
  : [injectedWallet];

const rpcTransport = (() => {
  const transports = rpcUrlList().map((url) =>
    http(url, { batch: { batchSize: 20, wait: 20 }, retryCount: 1, timeout: 12_000 }),
  );
  return transports.length > 1 ? fallback(transports, { rank: false }) : transports[0];
})();

export const wagmiConfig = createConfig({
  chains: [elysiumTestnet],
  connectors: connectorsForWallets([{ groupName: "Wallets", wallets }], {
    appName: "Seedix",
    projectId: projectId || "seedix-injected-only",
  }),
  pollingInterval: 20_000,
  batch: { multicall: { wait: 32 } },
  transports: {
    [elysiumTestnet.id]: rpcTransport,
  },
  ssr: true,
});
