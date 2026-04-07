export const SOLANA_NETWORK =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "localnet";

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "http://127.0.0.1:8899";

export const DEFAULT_ASSET_ID = Number(
  process.env.NEXT_PUBLIC_RWA_ASSET_ID ?? "0"
);

export const IS_LOCALNET = SOLANA_NETWORK === "localnet";
