import {
  AnchorProvider,
  BN,
  type Idl,
  Program,
} from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { bytesToHex } from "./format";
import { assetPda, marketplacePda, shareMintPda, userPda } from "./pdas";

export type BrowserWallet = {
  publicKey: PublicKey;
  signTransaction: (
    transaction: Transaction | VersionedTransaction
  ) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (
    transactions: (Transaction | VersionedTransaction)[]
  ) => Promise<(Transaction | VersionedTransaction)[]>;
};

type SnapshotArgs = {
  connection: Connection;
  idl: Idl;
  assetId: number;
  walletAddress?: string;
};

export type AssetSnapshot = {
  marketplace: {
    admin: string;
    nextAssetId: number;
  } | null;
  asset: {
    address: string;
    assetId: number;
    totalShares: bigint;
    soldShares: bigint;
    yieldRate: bigint;
    reservePool: bigint;
    documentHashHex: string;
    assetName: string;
    assetUri: string;
    admin: string;
    shareMint: string;
  } | null;
  user: {
    wallet: string;
    sharesOwned: bigint;
    lastClaimTimestamp: number;
    isWhitelisted: boolean;
  } | null;
  tokenBalance: bigint;
  mintMetadata: {
    name: string;
    symbol: string;
    uri: string;
    additionalMetadata: Record<string, string>;
  } | null;
};

const readonlyWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async () => {
    throw new Error("Wallet is not connected.");
  },
  signAllTransactions: async () => {
    throw new Error("Wallet is not connected.");
  },
};

export function createConnection(rpcUrl: string) {
  return new Connection(rpcUrl, "confirmed");
}

function createProgram(
  connection: Connection,
  idl: Idl,
  wallet?: BrowserWallet
) {
  const provider = new AnchorProvider(connection, wallet ?? readonlyWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  return new Program(idl, provider);
}

export async function fetchSnapshot({
  connection,
  idl,
  assetId,
  walletAddress,
}: SnapshotArgs): Promise<AssetSnapshot> {
  const program = createProgram(connection, idl);
  const marketplaceAddress = marketplacePda(program.programId);
  const assetAddress = assetPda(program.programId, assetId);
  const shareMintAddress = shareMintPda(program.programId, assetAddress);

  const [marketplace, asset] = await Promise.all([
    program.account.marketplaceState.fetchNullable(marketplaceAddress),
    program.account.assetState.fetchNullable(assetAddress),
  ]);

  let user: AssetSnapshot["user"] = null;
  let tokenBalance = 0n;

  if (walletAddress && asset) {
    const walletPublicKey = new PublicKey(walletAddress);
    const userAddress = userPda(program.programId, assetAddress, walletPublicKey);
    const userAccount = await program.account.userState.fetchNullable(userAddress);

    if (userAccount) {
      user = {
        wallet: userAccount.wallet.toBase58(),
        sharesOwned: BigInt(userAccount.sharesOwned.toString()),
        lastClaimTimestamp: Number(userAccount.lastClaimTimestamp.toString()),
        isWhitelisted: userAccount.isWhitelisted,
      };
    }

    const buyerAta = getAssociatedTokenAddressSync(
      shareMintAddress,
      walletPublicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    try {
      const balance = await connection.getTokenAccountBalance(buyerAta, "confirmed");
      tokenBalance = BigInt(balance.value.amount);
    } catch {
      tokenBalance = 0n;
    }
  }

  let mintMetadata: AssetSnapshot["mintMetadata"] = null;
  try {
    const metadata = await getTokenMetadata(
      connection,
      shareMintAddress,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    if (metadata) {
      mintMetadata = {
        name: metadata.name,
        symbol: metadata.symbol,
        uri: metadata.uri,
        additionalMetadata: Object.fromEntries(metadata.additionalMetadata),
      };
    }
  } catch {
    mintMetadata = null;
  }

  return {
    marketplace: marketplace
      ? {
          admin: marketplace.admin.toBase58(),
          nextAssetId: Number(marketplace.nextAssetId.toString()),
        }
      : null,
    asset: asset
      ? {
          address: assetAddress.toBase58(),
          assetId: Number(asset.assetId.toString()),
          totalShares: BigInt(asset.totalShares.toString()),
          soldShares: BigInt(asset.soldShares.toString()),
          yieldRate: BigInt(asset.yieldRate.toString()),
          reservePool: BigInt(asset.reservePool.toString()),
          documentHashHex: bytesToHex(asset.documentHash),
          assetName: asset.assetName,
          assetUri: asset.assetUri,
          admin: asset.admin.toBase58(),
          shareMint: asset.shareMint.toBase58(),
        }
      : null,
    user,
    tokenBalance,
    mintMetadata,
  };
}

export async function buyShares(args: {
  connection: Connection;
  idl: Idl;
  assetId: number;
  wallet: BrowserWallet;
  amount: number;
}) {
  const program = createProgram(args.connection, args.idl, args.wallet);
  const assetAddress = assetPda(program.programId, args.assetId);
  const shareMintAddress = shareMintPda(program.programId, assetAddress);
  const userAddress = userPda(
    program.programId,
    assetAddress,
    args.wallet.publicKey
  );
  const buyerAta = getAssociatedTokenAddressSync(
    shareMintAddress,
    args.wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  return program.methods
    .buyShares(new BN(args.amount))
    .accounts({
      assetState: assetAddress,
      userState: userAddress,
      shareMint: shareMintAddress,
      buyerShares: buyerAta,
      buyer: args.wallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function claimYield(args: {
  connection: Connection;
  idl: Idl;
  assetId: number;
  wallet: BrowserWallet;
}) {
  const program = createProgram(args.connection, args.idl, args.wallet);
  const assetAddress = assetPda(program.programId, args.assetId);
  const userAddress = userPda(
    program.programId,
    assetAddress,
    args.wallet.publicKey
  );

  return program.methods
    .claimYield()
    .accounts({
      assetState: assetAddress,
      userState: userAddress,
      user: args.wallet.publicKey,
    })
    .rpc();
}

export async function instantSell(args: {
  connection: Connection;
  idl: Idl;
  assetId: number;
  wallet: BrowserWallet;
  amount: number;
}) {
  const program = createProgram(args.connection, args.idl, args.wallet);
  const assetAddress = assetPda(program.programId, args.assetId);
  const shareMintAddress = shareMintPda(program.programId, assetAddress);
  const userAddress = userPda(
    program.programId,
    assetAddress,
    args.wallet.publicKey
  );
  const userAta = getAssociatedTokenAddressSync(
    shareMintAddress,
    args.wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  return program.methods
    .instantSell(new BN(args.amount))
    .accounts({
      assetState: assetAddress,
      userState: userAddress,
      shareMint: shareMintAddress,
      userShares: userAta,
      user: args.wallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
}
