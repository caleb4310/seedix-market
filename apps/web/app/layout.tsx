import type { Metadata } from "next";
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { tokenCss } from "@/lib/tokens";
import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Seedix",
  description: "Launch a coin on Elysium testnet. Keep the fees, kick them back, or burn them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <style dangerouslySetInnerHTML={{ __html: tokenCss }} />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var q=new URLSearchParams(location.search).get('theme');var t=q==='dark'||q==='light'?q:localStorage.getItem('seedix-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}",
          }}
        />
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
