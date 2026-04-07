import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { PhantomWalletProvider } from "@/components/phantom-provider";

export const metadata: Metadata = {
  title: "RWA Platform Demo",
  description:
    "Premium localnet investor demo for a Token-2022 real-world asset marketplace on Solana.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-[var(--color-ink)] text-[var(--color-sand)]">
        <PhantomWalletProvider>
          <div className="relative min-h-screen overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(153,174,196,0.12),_transparent_26%),radial-gradient(circle_at_bottom_left,_rgba(127,226,186,0.1),_transparent_24%),linear-gradient(180deg,#08101d_0%,#0a1626_38%,#09111d_100%)]" />
            <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:120px_120px]" />
            <div className="relative flex min-h-screen flex-col">
              <AppHeader />
              <main className="flex-1">{children}</main>
            </div>
          </div>
        </PhantomWalletProvider>
      </body>
    </html>
  );
}
