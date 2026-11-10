"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { elysiumTestnet } from "@/lib/chain";
import { WalletButton } from "./WalletButton";
import { Button } from "@/components/ui/Button";

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = window.localStorage.getItem("seedix-theme");
    const query = new URLSearchParams(window.location.search).get("theme");
    const next = query === "dark" || query === "light" ? query : stored === "dark" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("seedix-theme", next);
  }

  return (
    <div className="shell">
      <header className="nav">
        <Link href="/" className="wordmark">
          Seed<span>ix</span>
        </Link>
        <nav className="nav-links">
          <Link href="/" data-active={path === "/" ? "true" : "false"}>
            Coins
          </Link>
          <Link href="/launch" className="btn nav-launch" data-active={path.startsWith("/launch") ? "true" : "false"}>
            <span className="wide">Launch a coin</span>
            <span className="narrow">Launch</span>
          </Link>
          <Link href="/portfolio" data-active={path.startsWith("/portfolio") ? "true" : "false"}>
            <span className="wide">Portfolio</span>
            <span className="narrow">You</span>
          </Link>
        </nav>
        <div className="nav-spacer" />
        <div className="chain-pill">{elysiumTestnet.id === 99801 ? "ELYSIUM TESTNET · 99801" : `LOCAL · ${elysiumTestnet.id}`}</div>
        <Button variant="ghost" type="button" className="theme-toggle" onClick={toggle} aria-pressed={theme === "dark"} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
          {theme === "light" ? (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M10.2 2.4a6.2 6.2 0 1 0 5.4 9.2A5.2 5.2 0 0 1 10.2 2.4Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M9 2.2v1.3M9 14.5v1.3M2.2 9h1.3M14.5 9h1.3M4.2 4.2l.9.9M12.9 12.9l.9.9M13.8 4.2l-.9.9M5.1 12.9l-.9.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="9" cy="9" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          )}
        </Button>
        <WalletButton />
      </header>
      <main className="main">{children}</main>
      <footer className="footer">
        <span>Testnet only. Gas is HYPE. USD marks use the CoinGecko hyperliquid price when it is available.</span>
        <span>Fees: 1% platform, hook 80% to 1%, LP 0.1%.</span>
      </footer>
    </div>
  );
}
