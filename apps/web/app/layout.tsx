import type { Metadata } from "next";
import { headers } from "next/headers";
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { tokenCss } from "@/lib/tokens";
import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";

const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Seedix",
  description: "Launch a coin on Elysium testnet. Keep the fees, kick them back, or burn them.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <style dangerouslySetInnerHTML={{ __html: tokenCss }} />
        <script nonce={nonce} src="/theme.js" />
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
