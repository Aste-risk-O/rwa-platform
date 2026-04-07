"use client";

import Link from "next/link";
import { ShieldCheck, Wallet } from "lucide-react";
import { usePhantomWallet } from "./phantom-provider";
import { IS_LOCALNET, SOLANA_NETWORK } from "@/lib/solana/env";
import { formatWallet } from "@/lib/solana/format";

export function AppHeader() {
  const { ready, connected, connecting, publicKey, connect, disconnect } =
    usePhantomWallet();

  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[#07111dcc]/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-6 lg:px-10">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/6 text-[var(--color-sand)] shadow-[0_0_40px_rgba(4,10,18,0.18)]">
            <ShieldCheck className="h-5 w-5 text-[var(--color-success)]" />
          </div>
          <div>
            <p className="font-[family-name:var(--font-display-ui)] text-xl uppercase tracking-[0.18em] text-white">
              RWA Platform
            </p>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
              {IS_LOCALNET ? "Localnet demo" : SOLANA_NETWORK}
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <div className="hidden rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-emerald-100 sm:block">
            Compliance active
          </div>

          {!ready ? (
            <a
              href="https://phantom.app/"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-[var(--color-sand)] transition hover:bg-white/10"
            >
              Install Phantom
            </a>
          ) : connected && publicKey ? (
            <button
              type="button"
              onClick={() => void disconnect()}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-[var(--color-sand)] transition hover:bg-white/10"
            >
              <Wallet className="h-4 w-4" />
              {formatWallet(publicKey.toBase58())}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent-strong)] px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Wallet className="h-4 w-4" />
              {connecting ? "Connecting..." : "Connect Phantom"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
