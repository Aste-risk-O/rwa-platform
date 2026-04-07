import { LAMPORTS_PER_SOL, SECONDS_PER_DAY } from "./constants";

export function lamportsToSol(lamports: bigint) {
  return Number(lamports) / Number(LAMPORTS_PER_SOL);
}

export function formatSol(lamports: bigint, digits = 3) {
  return `${lamportsToSol(lamports).toFixed(digits)} SOL`;
}

export function formatWallet(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

export function bytesToHex(bytes: number[]) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function annualYieldPercent(yieldRatePerDay: bigint, sharePrice: bigint) {
  if (sharePrice === 0n) {
    return 0;
  }

  return Number(yieldRatePerDay * 36500n) / Number(sharePrice);
}

export function estimateYieldLamports(
  sharesOwned: bigint,
  lastClaimTimestamp: number,
  yieldRatePerDay: bigint,
  nowSeconds: number
) {
  if (sharesOwned <= 0n || lastClaimTimestamp <= 0) {
    return 0n;
  }

  const elapsed = BigInt(Math.max(0, nowSeconds - lastClaimTimestamp));
  return (elapsed * sharesOwned * yieldRatePerDay) / SECONDS_PER_DAY;
}

export function relativeSeconds(timestamp: number, nowSeconds: number) {
  if (timestamp <= 0) {
    return "No claims yet";
  }

  const delta = Math.max(0, nowSeconds - timestamp);
  if (delta < 60) {
    return `${delta}s ago`;
  }
  if (delta < 3600) {
    return `${Math.floor(delta / 60)}m ago`;
  }

  return `${Math.floor(delta / 3600)}h ago`;
}
