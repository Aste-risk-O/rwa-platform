"use client";

import type { Idl } from "@coral-xyz/anchor";
import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Shield,
  Sparkles,
  Wallet,
} from "lucide-react";
import {
  buyShares,
  claimYield,
  createConnection,
  fetchSnapshot,
  instantSell,
  type AssetSnapshot,
} from "@/lib/solana/rwa-client";
import {
  annualYieldPercent,
  estimateYieldLamports,
  formatSol,
  formatWallet,
  relativeSeconds,
} from "@/lib/solana/format";
import { SHARE_PRICE_LAMPORTS } from "@/lib/solana/constants";
import { DEFAULT_ASSET_ID, IS_LOCALNET, SOLANA_RPC_URL } from "@/lib/solana/env";
import { formatSolanaError } from "@/lib/solana/errors";
import { usePhantomWallet } from "./phantom-provider";
import type { DemoAssetPackage } from "@/lib/types";

type Props = {
  assetPackage: DemoAssetPackage;
  rwaIdl: Idl;
};

type TxState = {
  kind: "idle" | "success" | "error";
  title: string;
  detail?: string;
};

export function AssetDetailClient({ assetPackage, rwaIdl }: Props) {
  const { wallet, publicKey, connected, ready, connect } = usePhantomWallet();
  const [snapshot, setSnapshot] = useState<AssetSnapshot | null>(null);
  const [networkHealthy, setNetworkHealthy] = useState(true);
  const [loading, setLoading] = useState(true);
  const [buyAmount, setBuyAmount] = useState("1");
  const [sellAmount, setSellAmount] = useState("1");
  const [proofOpen, setProofOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [txState, setTxState] = useState<TxState>({
    kind: "idle",
    title: "Investor demo ready",
    detail:
      "Connect Phantom, whitelist in demo mode, then buy, verify and manage your position.",
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const [isPending, startTransition] = useTransition();

  const connection = useMemo(() => createConnection(SOLANA_RPC_URL), []);
  const assetId = assetPackage.config.assetId ?? DEFAULT_ASSET_ID;
  const annualYield = annualYieldPercent(
    BigInt(assetPackage.config.yieldRatePerDay),
    SHARE_PRICE_LAMPORTS
  );

  const refreshSnapshot = useEffectEvent(async () => {
    setLoading(true);
    try {
      await connection.getLatestBlockhash("confirmed");
      setNetworkHealthy(true);
      const nextSnapshot = await fetchSnapshot({
        connection,
        idl: rwaIdl,
        assetId,
        walletAddress: publicKey?.toBase58(),
      });
      setSnapshot(nextSnapshot);
    } catch (error) {
      setNetworkHealthy(false);
      setTxState({
        kind: "error",
        title: "Localnet is unreachable",
        detail: formatSolanaError(error),
      });
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void refreshSnapshot();
    const timer = window.setInterval(() => void refreshSnapshot(), 12_000);
    return () => window.clearInterval(timer);
  }, [refreshToken, publicKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const user = snapshot?.user ?? null;
  const asset = snapshot?.asset ?? null;
  const estimatedYield = user
    ? estimateYieldLamports(
        user.sharesOwned,
        user.lastClaimTimestamp,
        asset?.yieldRate ?? 0n,
        nowSeconds
      )
    : 0n;

  const verifyChecks = asset
    ? [
        {
          label: "AssetState document hash",
          value: asset.documentHashHex,
          ok: asset.documentHashHex === assetPackage.documentHash,
        },
        {
          label: "Mint metadata document hash",
          value:
            snapshot?.mintMetadata?.additionalMetadata.document_hash ?? "missing",
          ok:
            snapshot?.mintMetadata?.additionalMetadata.document_hash ===
            assetPackage.documentHash,
        },
        {
          label: "Mint metadata asset id",
          value: snapshot?.mintMetadata?.additionalMetadata.asset_id ?? "missing",
          ok:
            snapshot?.mintMetadata?.additionalMetadata.asset_id ===
            String(assetPackage.config.assetId),
        },
      ]
    : [];

  const verificationOk =
    verifyChecks.length > 0 && verifyChecks.every((check) => check.ok);

  async function runAction(label: string, action: () => Promise<string | void>) {
    startTransition(() => {
      setTxState({
        kind: "idle",
        title: `${label} in progress`,
        detail: "Approve the transaction in Phantom.",
      });
    });
    try {
      const signature = await action();
      setTxState({
        kind: "success",
        title: `${label} confirmed`,
        detail: signature ? `Signature: ${signature}` : "State updated on localnet.",
      });
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setTxState({
        kind: "error",
        title: `${label} failed`,
        detail: formatSolanaError(error),
      });
    }
  }

  async function handleDemoWhitelist() {
    if (!publicKey) throw new Error("Connect Phantom first.");
    const response = await fetch("/api/demo/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, wallet: publicKey.toBase58() }),
    });
    const payload = (await response.json()) as {
      error?: string;
      signature?: string;
      status?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "Demo whitelist request failed.");
    }
    return payload.signature ?? payload.status ?? "whitelisted";
  }

  async function handleBuy() {
    if (!wallet) throw new Error("Connect Phantom first.");
    const amount = Number.parseInt(buyAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Enter a valid whole share amount.");
    }
    return buyShares({ connection, idl: rwaIdl, assetId, wallet, amount });
  }

  async function handleClaim() {
    if (!wallet) throw new Error("Connect Phantom first.");
    return claimYield({ connection, idl: rwaIdl, assetId, wallet });
  }

  async function handleSell() {
    if (!wallet) throw new Error("Connect Phantom first.");
    const amount = Number.parseInt(sellAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Enter a valid whole share amount.");
    }
    return instantSell({ connection, idl: rwaIdl, assetId, wallet, amount });
  }

  const walletLabel =
    connected && publicKey ? formatWallet(publicKey.toBase58()) : null;
  const whitelistReady = Boolean(connected && user?.isWhitelisted);
  const mintedName =
    snapshot?.mintMetadata?.name ?? assetPackage.metadata.properties.display_name;
  const mintedSymbol =
    snapshot?.mintMetadata?.symbol ??
    assetPackage.metadata.symbol ??
    assetPackage.metadata.properties.asset_symbol;
  const heroImage =
    assetPackage.metadata.properties.hero_image ?? assetPackage.metadata.image;
  const proofImage =
    assetPackage.metadata.properties.proof_image ?? assetPackage.metadata.image;
  const galleryImages =
    assetPackage.metadata.properties.gallery_images?.length
      ? assetPackage.metadata.properties.gallery_images
      : [heroImage];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8 sm:px-6 lg:px-10 lg:py-12">
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] shadow-[0_35px_120px_rgba(2,8,18,0.5)]">
        <div className="grid gap-0 lg:grid-cols-[1.22fr_0.78fr]">
          <div className="relative min-h-[440px] border-b border-white/10 lg:min-h-[620px] lg:border-b-0 lg:border-r">
            <Image
              src={heroImage}
              alt={assetPackage.metadata.properties.display_name}
              fill
              priority
              className="object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,11,20,0.08),rgba(5,11,20,0.45)_36%,rgba(5,11,20,0.9)_100%)]" />
            <div className="absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-3 p-5 sm:p-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/45 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-[var(--color-sand)]/85 backdrop-blur">
                <BadgeCheck className="h-4 w-4 text-[var(--color-success)]" />
                Tokenized retail income asset
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/12 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-emerald-100">
                {verificationOk ? "Hash verified" : "Awaiting verification"}
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7 lg:p-9">
              <div className="max-w-3xl">
                <p className="text-xs uppercase tracking-[0.32em] text-[var(--color-sand)]/60">
                  Astana street retail
                </p>
                <h1 className="mt-4 font-[family-name:var(--font-display-ui)] text-5xl leading-[0.9] text-white sm:text-6xl lg:text-7xl">
                  {assetPackage.metadata.properties.display_name}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-sand)]/78 sm:text-lg">
                  Buy Token-2022 shares, watch yield accrue live and verify the
                  asset against its document package.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a
                    href="#buy"
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent-strong)] px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105"
                  >
                    Buy shares
                    <ArrowRight className="h-4 w-4" />
                  </a>
                  <a
                    href="#portfolio"
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-5 py-3 text-sm font-medium text-[var(--color-sand)] transition hover:bg-white/10"
                  >
                    Watch yield
                  </a>
                  <a
                    href="#verify"
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-5 py-3 text-sm font-medium text-[var(--color-sand)] transition hover:bg-white/10"
                  >
                    Verify asset
                  </a>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <HeroMetric label="Share price" value={formatSol(SHARE_PRICE_LAMPORTS)} />
                  <HeroMetric label="Projected annual yield" value={`${annualYield.toFixed(2)}%`} />
                  <HeroMetric label="Asset address" value={assetPackage.metadata.properties.address} compact />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 sm:max-w-md">
                  {galleryImages.slice(0, 3).map((image, index) => (
                    <div
                      key={image}
                      className="relative h-20 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/35"
                    >
                      <Image
                        src={image}
                        alt={`${assetPackage.metadata.properties.display_name} photo ${index + 1}`}
                        fill
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-5 p-5 sm:p-7 lg:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-[26px] border border-white/10 bg-slate-950/35 p-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
                  Demo status
                </p>
                <p className="mt-2 text-sm text-[var(--color-sand)]/88">
                  {walletLabel
                    ? `Wallet ${walletLabel}`
                    : ready
                      ? "Connect Phantom to start the tokenholder flow."
                      : "Install Phantom to test the full demo."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.24em]">
                  <StatusChip tone={networkHealthy ? "success" : "danger"} label={networkHealthy ? "Localnet live" : "RPC offline"} />
                  <StatusChip tone={whitelistReady ? "success" : "neutral"} label={whitelistReady ? "Whitelist active" : "Whitelist pending"} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!connected && ready ? (
                  <button
                    type="button"
                    onClick={() => void connect()}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm font-medium text-[var(--color-sand)] transition hover:bg-white/10"
                  >
                    <Wallet className="h-4 w-4" />
                    Connect
                  </button>
                ) : null}
                {IS_LOCALNET ? (
                  <button
                    type="button"
                    disabled={!connected || user?.isWhitelisted || isPending}
                    onClick={() => void runAction("Demo whitelist", handleDemoWhitelist)}
                    className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-50 transition hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {user?.isWhitelisted ? "Verified" : "Demo whitelist"}
                  </button>
                ) : null}
              </div>
            </div>
            <div id="buy" className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.025))] p-5 shadow-[0_24px_80px_rgba(2,8,18,0.36)] sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
                    Buy shares
                  </p>
                  <h2 className="mt-2 font-[family-name:var(--font-display-ui)] text-4xl leading-none text-white">
                    Enter the asset in one click.
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-sand)]/72">
                    Mint live shares into Phantom and fund the reserve in the same flow.
                  </p>
                </div>
                {isPending ? (
                  <LoaderCircle className="mt-1 h-5 w-5 animate-spin text-[var(--color-accent-strong)]" />
                ) : null}
              </div>
              <label className="mt-6 block">
                <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Shares
                </span>
                <div className="mt-2 flex items-center gap-3 rounded-[24px] border border-white/10 bg-slate-950/40 px-4 py-3">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={buyAmount}
                    onChange={(event) => setBuyAmount(event.target.value)}
                    className="w-full bg-transparent text-2xl font-medium text-white outline-none placeholder:text-[var(--color-muted)]"
                  />
                  <span className="text-sm text-[var(--color-sand)]/58">x {formatSol(SHARE_PRICE_LAMPORTS)}</span>
                </div>
              </label>
              <button
                type="button"
                disabled={!connected || !user?.isWhitelisted || isPending}
                onClick={() => void runAction("Buy shares", handleBuy)}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-accent-strong)] px-5 py-4 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Buy shares
                <ArrowRight className="h-4 w-4" />
              </button>
              <div className="mt-4 flex flex-wrap gap-3 text-sm text-[var(--color-sand)]/65">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Token-2022 mint</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Transfer hook enforced</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{connected ? "Ready for signature" : "Wallet required"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="portfolio" className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.025))] p-5 shadow-[0_25px_90px_rgba(2,8,18,0.34)] sm:p-6 lg:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
                Tokenholder portfolio
              </p>
              <h2 className="mt-2 font-[family-name:var(--font-display-ui)] text-4xl leading-none text-white">
                Live yield keeps the story moving.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-sand)]/72">
                The number updates every second from your on-chain ownership and last claim timestamp.
              </p>
            </div>
            {loading ? (
              <LoaderCircle className="mt-1 h-5 w-5 animate-spin text-[var(--color-accent-strong)]" />
            ) : null}
          </div>

          <div className="mt-8 rounded-[30px] border border-emerald-400/18 bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.05))] p-6 sm:p-8">
            <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-100/80">
              Estimated yield
            </p>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-[family-name:var(--font-display-ui)] text-6xl leading-none text-white sm:text-7xl">
                  {formatSol(estimatedYield, 6)}
                </p>
                <p className="mt-3 text-sm text-emerald-50/78">
                  {user
                    ? `Last claim ${relativeSeconds(user.lastClaimTimestamp, nowSeconds)}`
                    : "Connect your wallet to start a personal yield stream."}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/32 px-4 py-3 text-sm text-[var(--color-sand)]/78">
                Updating live
                <span className="sr-only">{clockTick}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CompactMetric label="Your shares" value={user ? user.sharesOwned.toString() : "--"} />
            <CompactMetric label="Token balance" value={snapshot ? snapshot.tokenBalance.toString() : "--"} />
            <CompactMetric label="Reserve pool" value={asset ? formatSol(asset.reservePool) : "--"} />
            <CompactMetric
              label="Sold shares"
              value={
                asset
                  ? `${asset.soldShares.toString()} / ${asset.totalShares.toString()}`
                  : "--"
              }
            />
          </div>
        </div>

        <div className="grid gap-6">
          <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.025))] p-5 shadow-[0_25px_90px_rgba(2,8,18,0.34)] sm:p-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
                Portfolio actions
              </p>
              <h2 className="mt-2 font-[family-name:var(--font-display-ui)] text-4xl leading-none text-white">
                Claim or exit without leaving the page.
              </h2>
            </div>

            <div className="mt-6 space-y-4">
              <MiniAction
                title="Claim yield"
                body="Pays accrued SOL from the reserve pool to your wallet."
                buttonLabel="Claim yield"
                disabled={!connected || !user?.isWhitelisted || !user?.sharesOwned || isPending}
                onClick={() => void runAction("Claim yield", handleClaim)}
              />
              <MiniAction
                title="Instant sell"
                body="Burns your shares and returns 90% of the fixed share price."
                value={sellAmount}
                onValueChange={setSellAmount}
                buttonLabel="Instant sell"
                disabled={!connected || !user?.isWhitelisted || !user?.sharesOwned || isPending}
                onClick={() => void runAction("Instant sell", handleSell)}
              />
            </div>

            <div className="mt-5 rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
              <div className="flex items-start gap-3">
                <Shield className="mt-0.5 h-5 w-5 text-[var(--color-success)]" />
                <div>
                  <p className="text-sm font-medium text-white">
                    Secondary transfers stay regulated
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-sand)]/68">
                    Token-2022 transfer hook keeps movement marketplace-controlled, so entitlement accounting stays consistent.
                  </p>
                </div>
              </div>
            </div>

            <StatusBanner txState={txState} />
          </div>
        </div>
      </section>

      <section id="verify" className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] p-5 shadow-[0_25px_90px_rgba(2,8,18,0.34)] sm:p-6 lg:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
              Verify asset
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display-ui)] text-4xl leading-none text-white">
              Trust comes from a matching hash, not a promise.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-sand)]/72">
              We compare the document bundle, AssetState hash and mint metadata so the token points back to a real package.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setProofOpen((value) => !value)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/6 px-5 py-3 text-sm font-medium text-[var(--color-sand)] transition hover:bg-white/10"
          >
            <Sparkles className="h-4 w-4" />
            {proofOpen ? "Hide proof" : "Verify asset"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/35">
            <div className="relative h-56 sm:h-72">
              <Image
                src={proofImage}
                alt={assetPackage.metadata.properties.display_name}
                fill
                className="object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,10,18,0.05),rgba(4,10,18,0.72)_100%)]" />
            </div>
            <div className="grid gap-3 p-5">
              <ProofSummary label="Address" value={assetPackage.metadata.properties.address} />
              <ProofSummary label="Asset id" value={String(assetPackage.config.assetId)} />
              <ProofSummary label="Mint" value={asset?.shareMint ?? "Waiting for localnet"} mono />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-[26px] border border-emerald-400/18 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(16,185,129,0.04))] p-5">
              <div className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 h-5 w-5 text-[var(--color-success)]" />
                <div>
                  <p className="text-base font-medium text-white">
                    {verificationOk ? "Hash matches on-chain" : "Verification incomplete"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-emerald-50/78">
                    {verificationOk
                      ? "The token metadata and contract state both resolve to the same document package."
                      : "The proof panel is waiting for all metadata checks to resolve."}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ProofSummary label="Mint metadata" value={`${mintedName} (${mintedSymbol})`} />
              <ProofSummary label="Document hash" value={assetPackage.documentHash} mono />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ProofSummary
                label="Metadata URI"
                value={snapshot?.mintMetadata?.uri ?? assetPackage.config.assetUri}
                href={snapshot?.mintMetadata?.uri ?? assetPackage.config.assetUri}
              />
              <ProofSummary
                label="Bundle manifest"
                value={assetPackage.metadata.properties.document_manifest_url}
                href={assetPackage.metadata.properties.document_manifest_url}
              />
            </div>

            {proofOpen ? (
              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                <button
                  type="button"
                  onClick={() => setDetailsOpen((value) => !value)}
                  className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-sand)] transition hover:text-white"
                >
                  <ExternalLink className="h-4 w-4" />
                  {detailsOpen ? "Hide raw checks" : "Show raw checks"}
                </button>

                {detailsOpen ? (
                  <div className="mt-4 grid gap-3">
                    {verifyChecks.map((check) => (
                      <div
                        key={check.label}
                        className={`rounded-2xl border px-4 py-3 ${
                          check.ok
                            ? "border-emerald-400/18 bg-emerald-500/8 text-emerald-100"
                            : "border-red-400/18 bg-red-500/8 text-red-100"
                        }`}
                      >
                        <p className="text-[11px] uppercase tracking-[0.24em]">{check.label}</p>
                        <p className="mt-2 break-all font-mono text-xs sm:text-sm">{check.value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function HeroMetric(props: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/35 px-4 py-4 backdrop-blur-sm">
      <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-sand)]/48">
        {props.label}
      </p>
      <p
        className={`mt-3 text-white ${
          props.compact
            ? "text-sm leading-6 text-[var(--color-sand)]/88"
            : "font-[family-name:var(--font-display-ui)] text-4xl leading-none"
        }`}
      >
        {props.value}
      </p>
    </div>
  );
}

function StatusChip(props: {
  tone: "success" | "neutral" | "danger";
  label: string;
}) {
  const className =
    props.tone === "success"
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
      : props.tone === "danger"
        ? "border-red-400/18 bg-red-500/10 text-red-100"
        : "border-white/10 bg-white/6 text-[var(--color-sand)]/78";

  return <span className={`rounded-full border px-3 py-1.5 ${className}`}>{props.label}</span>;
}

function CompactMetric(props: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/28 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
        {props.label}
      </p>
      <p className="mt-3 font-[family-name:var(--font-display-ui)] text-3xl leading-none text-white">
        {props.value}
      </p>
    </div>
  );
}

function MiniAction(props: {
  title: string;
  body: string;
  value?: string;
  onValueChange?: (value: string) => void;
  buttonLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-md">
          <p className="text-base font-medium text-white">{props.title}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-sand)]/68">{props.body}</p>
        </div>

        <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[220px]">
          {props.value !== undefined && props.onValueChange ? (
            <input
              type="number"
              min="1"
              step="1"
              value={props.value}
              onChange={(event) => props.onValueChange?.(event.target.value)}
              className="w-full rounded-full border border-white/10 bg-black/18 px-4 py-3 text-sm text-white outline-none placeholder:text-[var(--color-muted)] focus:border-white/20"
            />
          ) : null}
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onClick}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-white/92 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {props.buttonLabel}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProofSummary(props: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
}) {
  const content = props.href ? (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 break-all text-[var(--color-sand)] transition hover:text-white"
    >
      {props.value}
      <ExternalLink className="h-4 w-4 shrink-0" />
    </a>
  ) : (
    <span className={`break-all text-[var(--color-sand)] ${props.mono ? "font-mono text-xs sm:text-sm" : ""}`}>
      {props.value}
    </span>
  );

  return (
    <div className="rounded-[22px] border border-white/10 bg-slate-950/30 p-4">
      <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
        {props.label}
      </p>
      <div className="mt-2">{content}</div>
    </div>
  );
}

function StatusBanner({ txState }: { txState: TxState }) {
  const styles =
    txState.kind === "success"
      ? "border-emerald-400/18 bg-emerald-500/10 text-emerald-100"
      : txState.kind === "error"
        ? "border-red-400/18 bg-red-500/10 text-red-100"
        : "border-white/10 bg-white/5 text-[var(--color-sand)]";

  return (
    <div className={`mt-5 rounded-[24px] border p-4 ${styles}`}>
      <div className="flex items-start gap-3">
        {txState.kind === "error" ? (
          <CircleAlert className="mt-0.5 h-5 w-5" />
        ) : (
          <Sparkles className="mt-0.5 h-5 w-5" />
        )}
        <div>
          <p className="font-medium">{txState.title}</p>
          {txState.detail ? (
            <p className="mt-2 break-words text-sm leading-6 opacity-90">{txState.detail}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
