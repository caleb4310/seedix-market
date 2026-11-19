"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { appChain } from "@/lib/chain";
import { seedixRainbowDark, seedixRainbowLight } from "@/lib/rainbowTheme";
import { wagmiConfig } from "@/lib/wagmi";
import { ToastProvider } from "@/components/ui/Toast";

function useSeedixMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    const read = () => setMode(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

function SeedixRainbow({ children }: { children: ReactNode }) {
  const mode = useSeedixMode();
  return (
    <RainbowKitProvider initialChain={appChain} theme={mode === "dark" ? seedixRainbowDark : seedixRainbowLight}>
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchIntervalInBackground: false,
            refetchOnWindowFocus: false,
            staleTime: 8_000,
          },
        },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <SeedixRainbow>
          <ToastProvider>{children}</ToastProvider>
        </SeedixRainbow>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
