import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { AnchorProvider, type Idl, Program, Wallet } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assetPda, userPda } from "../solana/pdas";
import type {
  DemoAssetConfig,
  DemoAssetMetadata,
  DemoAssetPackage,
  DemoManifest,
} from "../types";

function contractsRoot() {
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "..",
    "contracts",
    "rwa-contracts"
  );
}

export async function getDemoAssetPackage(): Promise<DemoAssetPackage> {
  const root = contractsRoot();
  const configPath = path.join(root, "devnet", "astana-coffee-shop.asset.json");
  const config = JSON.parse(
    await fs.readFile(configPath, "utf8")
  ) as DemoAssetConfig;
  const metadataPath = path.resolve(path.dirname(configPath), config.metadataPath!);
  const manifestPath = path.resolve(path.dirname(configPath), config.documentPath);

  const [metadata, manifest, rwaIdl, hookIdl] = await Promise.all([
    readJson<DemoAssetMetadata>(metadataPath),
    readJson<DemoManifest>(manifestPath),
    readJson<Record<string, unknown>>(
      path.join(root, "target", "idl", "rwa_contracts.json")
    ),
    readJson<Record<string, unknown>>(
      path.join(root, "target", "idl", "rwa_transfer_hook.json")
    ),
  ]);

  const documentHash = crypto
    .createHash("sha256")
    .update(await fs.readFile(manifestPath))
    .digest("hex");

  return {
    config,
    metadata,
    manifest,
    documentHash,
    rwaIdl,
    hookProgramId: String(hookIdl.address),
  };
}

async function readJson<T>(filePath: string) {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export function resolveAdminKeypairPath() {
  const candidates = [
    process.env.RWA_ADMIN_KEYPAIR_PATH,
    path.join(os.homedir(), ".config", "solana", "id.json"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function readAdminKeypair() {
  const keypairPath = resolveAdminKeypairPath();
  if (!keypairPath) {
    throw new Error(
      "RWA_ADMIN_KEYPAIR_PATH is not set and no local Solana keypair was found. Point the app server to the marketplace admin keypair."
    );
  }

  const secret = JSON.parse(readFileSync(keypairPath, "utf8")) as number[];
  return {
    keypairPath,
    keypair: Keypair.fromSecretKey(Uint8Array.from(secret)),
  };
}

export async function addWalletToWhitelist(args: {
  connection: Connection;
  idl: Idl;
  assetId: number;
  walletAddress: string;
}) {
  const { keypair, keypairPath } = readAdminKeypair();
  const provider = new AnchorProvider(args.connection, new Wallet(keypair), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(args.idl, provider);
  const walletPublicKey = new PublicKey(args.walletAddress);
  const assetAddress = assetPda(program.programId, args.assetId);
  const userAddress = userPda(program.programId, assetAddress, walletPublicKey);
  const userState = await program.account.userState.fetchNullable(userAddress);

  if (userState?.isWhitelisted) {
    return {
      status: "already_whitelisted" as const,
      userState: userAddress.toBase58(),
      keypairPath,
    };
  }

  const method = userState
    ? program.methods.setWhitelistStatus(walletPublicKey, true)
    : program.methods.addToWhitelist(walletPublicKey);

  const signature = await method
    .accounts({
      assetState: assetAddress,
      userState: userAddress,
      admin: keypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return {
    status: "whitelisted" as const,
    signature,
    userState: userAddress.toBase58(),
    keypairPath,
  };
}
