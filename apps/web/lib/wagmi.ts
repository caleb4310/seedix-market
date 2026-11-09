import { injected } from "@wagmi/core";
import { createConfig, http } from "wagmi";
import { elysiumTestnet } from "./chain";

export const wagmiConfig = createConfig({
  chains: [elysiumTestnet],
  connectors: [injected()],
  transports: { [elysiumTestnet.id]: http(elysiumTestnet.rpcUrls.default.http[0]) },
  ssr: true,
});
