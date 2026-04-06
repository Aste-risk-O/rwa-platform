const anchor = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const RWA_IDL = require("../target/idl/rwa_contracts.json");
const HOOK_IDL = require("../target/idl/rwa_transfer_hook.json");

const { PublicKey, SystemProgram, Keypair } = anchor.web3;
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

async function main() {
  const workspaceRoot = path.resolve(__dirname, "..");
  const configPath =
    process.env.RWA_ASSET_CONFIG ||
    path.join(workspaceRoot, "devnet", "astana-coffee-shop.asset.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  validateConfig(config, configPath);
  const provider = buildProvider();

  anchor.setProvider(provider);

  const rwaProgram = new anchor.Program(RWA_IDL, provider);
  const hookProgram = new anchor.Program(HOOK_IDL, provider);
  const admin = provider.wallet.publicKey;

  const [marketplace] = PublicKey.findProgramAddressSync(
    [Buffer.from("marketplace")],
    rwaProgram.programId
  );

  const desiredAssetId =
    config.assetId ??
    Number((await fetchMarketplaceNextId(rwaProgram, marketplace)) ?? 0);
  const assetState = assetPda(rwaProgram.programId, desiredAssetId);
  const shareMint = shareMintPda(rwaProgram.programId, assetState);
  const extraAccountMetaList = extraAccountMetaPda(
    hookProgram.programId,
    shareMint
  );

  const documentPath = path.resolve(path.dirname(configPath), config.documentPath);
  const documentHash = sha256Bytes(documentPath);
  const metadataPath = config.metadataPath
    ? path.resolve(path.dirname(configPath), config.metadataPath)
    : null;

  console.log(`RPC: ${provider.connection.rpcEndpoint}`);
  console.log(`Admin: ${admin.toBase58()}`);
  console.log(`Marketplace: ${marketplace.toBase58()}`);
  console.log(`Asset PDA: ${assetState.toBase58()}`);
  console.log(`Share mint PDA: ${shareMint.toBase58()}`);
  console.log(`Hook metas PDA: ${extraAccountMetaList.toBase58()}`);
  console.log(`Document bundle: ${documentPath}`);
  console.log(`Document SHA-256: ${Buffer.from(documentHash).toString("hex")}`);
  if (metadataPath) {
    console.log(`Local metadata file: ${metadataPath}`);
  }
  console.log(`Configured asset URI: ${config.assetUri}`);

  const marketplaceState = await rwaProgram.account.marketplaceState.fetchNullable(
    marketplace
  );

  if (!marketplaceState) {
    console.log("Initializing marketplace...");
    await rwaProgram.methods
      .initializeMarketplace()
      .accounts({
        marketplace,
        admin,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log("Marketplace already exists, reusing it.");
  }

  const assetStateAccount = await rwaProgram.account.assetState.fetchNullable(
    assetState
  );

  if (!assetStateAccount) {
    const currentMarketplace = await rwaProgram.account.marketplaceState.fetch(
      marketplace
    );
    const nextId = Number(currentMarketplace.nextAssetId.toString());
    if (nextId !== desiredAssetId) {
      throw new Error(
        `Config assetId=${desiredAssetId} does not match marketplace next_asset_id=${nextId}`
      );
    }

    console.log("Creating asset...");
    await rwaProgram.methods
      .initializeAsset(
        new anchor.BN(config.totalShares),
        new anchor.BN(config.yieldRatePerDay),
        Array.from(documentHash),
        config.assetName,
        config.assetUri
      )
      .accounts({
        marketplace,
        assetState,
        admin,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log("Asset already exists, reusing it.");
  }

  const shareMintInfo = await provider.connection.getAccountInfo(shareMint);
  if (!shareMintInfo) {
    console.log("Initializing share mint...");
    await rwaProgram.methods
      .initializeShareMint()
      .accounts({
        assetState,
        shareMint,
        admin,
        transferHookProgram: hookProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log("Share mint already exists, reusing it.");
  }

  const metadata = await getTokenMetadataMaybe(provider, shareMint);
  if (!metadata) {
    console.log("Initializing share metadata...");
    await rwaProgram.methods
      .initializeShareMetadata(config.shareSymbol)
      .accounts({
        assetState,
        shareMint,
        admin,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  } else {
    console.log("Share metadata already exists, reusing it.");
  }

  const extraMetaInfo = await provider.connection.getAccountInfo(extraAccountMetaList);
  if (!extraMetaInfo) {
    console.log("Configuring transfer-hook extra accounts...");
    await hookProgram.methods
      .configureAssetHook()
      .accounts({
        admin,
        extraAccountMetaList: extraAccountMetaList,
        shareMint,
        assetState,
        rwaContractsProgram: rwaProgram.programId,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log("Transfer-hook metadata already exists, reusing it.");
  }

  if (Array.isArray(config.initialWhitelist)) {
    for (const wallet of config.initialWhitelist) {
      const walletPubkey = new PublicKey(wallet);
      const userState = userPda(rwaProgram.programId, assetState, walletPubkey);
      const existing = await rwaProgram.account.userState.fetchNullable(userState);
      if (existing?.isWhitelisted) {
        console.log(`Whitelist already contains ${walletPubkey.toBase58()}`);
        continue;
      }

      console.log(`Whitelisting ${walletPubkey.toBase58()}...`);
      await rwaProgram.methods
        .addToWhitelist(walletPubkey)
        .accounts({
          assetState,
          userState,
          admin,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  }

  if (config.reserveTopUpLamports && Number(config.reserveTopUpLamports) > 0) {
    const asset = await rwaProgram.account.assetState.fetch(assetState);
    const currentReserve = BigInt(asset.reservePool.toString());
    const targetReserve = BigInt(config.reserveTopUpLamports);
    if (currentReserve < targetReserve) {
      const delta = targetReserve - currentReserve;
      console.log(`Topping reserve up by ${delta.toString()} lamports...`);
      await rwaProgram.methods
        .reserveTopUp(new anchor.BN(delta.toString()))
        .accounts({
          assetState,
          admin,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } else {
      console.log("Reserve already meets or exceeds configured target.");
    }
  }

  const finalAsset = await rwaProgram.account.assetState.fetch(assetState);
  const finalMetadata = await getTokenMetadataMaybe(provider, shareMint);

  console.log("");
  console.log("Seed complete.");
  console.log(`Asset id: ${finalAsset.assetId.toString()}`);
  console.log(`Asset name: ${finalAsset.assetName}`);
  console.log(`Asset URI: ${finalAsset.assetUri}`);
  console.log(`Reserve pool: ${finalAsset.reservePool.toString()}`);
  console.log(`Share mint: ${finalAsset.shareMint.toBase58()}`);
  if (finalMetadata) {
    console.log(`Metadata name: ${finalMetadata.name}`);
    console.log(`Metadata symbol: ${finalMetadata.symbol}`);
    console.log(`Metadata uri: ${finalMetadata.uri}`);
  }
}

function buildProvider() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const walletPath = expandHome(
    process.env.ANCHOR_WALLET || "~/.config/solana/id.json"
  );
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(payer);

  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

function validateConfig(config, configPath) {
  const required = [
    "assetName",
    "shareSymbol",
    "assetUri",
    "documentPath",
    "totalShares",
    "yieldRatePerDay",
  ];
  for (const key of required) {
    if (
      config[key] === undefined ||
      config[key] === null ||
      config[key] === ""
    ) {
      throw new Error(`Missing required config field "${key}" in ${configPath}`);
    }
  }

  const documentPath = path.resolve(path.dirname(configPath), config.documentPath);
  if (!fs.existsSync(documentPath)) {
    throw new Error(`Document bundle file does not exist: ${documentPath}`);
  }

  if (config.metadataPath) {
    const metadataPath = path.resolve(path.dirname(configPath), config.metadataPath);
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Metadata file does not exist: ${metadataPath}`);
    }
  }
}

async function fetchMarketplaceNextId(program, marketplace) {
  const marketplaceState = await program.account.marketplaceState.fetchNullable(
    marketplace
  );
  return marketplaceState ? marketplaceState.nextAssetId : null;
}

async function getTokenMetadataMaybe(provider, mint) {
  try {
    const { getTokenMetadata } = require("@solana/spl-token");
    return await getTokenMetadata(
      provider.connection,
      mint,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
  } catch (_error) {
    return null;
  }
}

function sha256Bytes(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest();
}

function expandHome(filePath) {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function assetPda(programId, id) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), u64le(id)],
    programId
  )[0];
}

function shareMintPda(programId, asset) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), asset.toBuffer()],
    programId
  )[0];
}

function extraAccountMetaPda(programId, shareMint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), shareMint.toBuffer()],
    programId
  )[0];
}

function userPda(programId, asset, wallet) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), asset.toBuffer(), wallet.toBuffer()],
    programId
  )[0];
}

function u64le(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
