"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
          <Link href="/launch" data-active={path.startsWith("/launch") ? "true" : "false"}>
            Launch
          </Link>
        </nav>
        <div className="nav-spacer" />
        <div className="chain-pill">ELYSIUM TESTNET · 99801</div>
        <Button variant="ghost" type="button" className="theme-toggle" onClick={toggle} aria-pressed={theme === "dark"} aria-label={theme === "light" ? "Switch to dark" : "Switch to light"}>
          Aa
        </Button>
        <WalletButton />
      </header>
      <main className="main">{children}</main>
      <footer className="footer">
        <span>Testnet only. Gas is HYPE.</span>
        <span>Fees: 1% platform, hook 80% to 1%, LP 0.1%.</span>
      </footer>
    </div>
  );
}
