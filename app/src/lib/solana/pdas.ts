import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

function u64le(value: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export function marketplacePda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("marketplace")],
    programId
  )[0];
}

export function assetPda(programId: PublicKey, assetId: number) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), u64le(assetId)],
    programId
  )[0];
}

export function shareMintPda(programId: PublicKey, asset: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), asset.toBuffer()],
    programId
  )[0];
}

export function userPda(
  programId: PublicKey,
  asset: PublicKey,
  wallet: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), asset.toBuffer(), wallet.toBuffer()],
    programId
  )[0];
}
