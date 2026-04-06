const anchor = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const RWA_IDL = require("../target/idl/rwa_contracts.json");
const { PublicKey, Keypair } = anchor.web3;
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

async function main() {
  const workspaceRoot = path.resolve(__dirname, "..");
  const configPath =
    process.env.RWA_ASSET_CONFIG ||
    path.join(workspaceRoot, "devnet", "astana-coffee-shop.asset.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const provider = buildProvider();
  const { getTokenMetadata } = require("@solana/spl-token");

  anchor.setProvider(provider);

  const rwaProgram = new anchor.Program(RWA_IDL, provider);
  const [marketplace] = PublicKey.findProgramAddressSync(
    [Buffer.from("marketplace")],
    rwaProgram.programId
  );
  const assetId = Number(config.assetId ?? 0);
  const assetState = assetPda(rwaProgram.programId, assetId);
  const documentPath = path.resolve(path.dirname(configPath), config.documentPath);
  const expectedDocumentHash = sha256Hex(documentPath);

  console.log(`RPC: ${provider.connection.rpcEndpoint}`);
  console.log(`Marketplace: ${marketplace.toBase58()}`);
  console.log(`Asset PDA: ${assetState.toBase58()}`);
  console.log(`Expected document hash: ${expectedDocumentHash}`);

  const asset = await rwaProgram.account.assetState.fetch(assetState);
  const onChainDocumentHash = Buffer.from(asset.documentHash).toString("hex");
  const metadata = await getTokenMetadata(
    provider.connection,
    asset.shareMint,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );
  const additionalMetadata = Object.fromEntries(metadata.additionalMetadata);

  const checks = [
    {
      name: "asset_id matches config",
      ok: Number(asset.assetId.toString()) === assetId,
      details: `config=${assetId}, onchain=${asset.assetId.toString()}`,
    },
    {
      name: "asset_name matches config",
      ok: asset.assetName === config.assetName,
      details: `config=${config.assetName}, onchain=${asset.assetName}`,
    },
    {
      name: "asset_uri matches config",
      ok: asset.assetUri === config.assetUri,
      details: `config=${config.assetUri}, onchain=${asset.assetUri}`,
    },
    {
      name: "document_hash matches bundle manifest",
      ok: onChainDocumentHash === expectedDocumentHash,
      details: `bundle=${expectedDocumentHash}, onchain=${onChainDocumentHash}`,
    },
    {
      name: "mint metadata name matches convention",
      ok: metadata.name === `${config.assetName} Shares`,
      details: `metadata=${metadata.name}`,
    },
    {
      name: "mint metadata symbol matches config",
      ok: metadata.symbol === config.shareSymbol,
      details: `config=${config.shareSymbol}, metadata=${metadata.symbol}`,
    },
    {
      name: "mint metadata uri matches asset_uri",
      ok: metadata.uri === config.assetUri,
      details: `config=${config.assetUri}, metadata=${metadata.uri}`,
    },
    {
      name: "mint metadata asset_id matches",
      ok: additionalMetadata.asset_id === String(assetId),
      details: `metadata=${additionalMetadata.asset_id}`,
    },
    {
      name: "mint metadata document_hash matches",
      ok: additionalMetadata.document_hash === expectedDocumentHash,
      details: `metadata=${additionalMetadata.document_hash}`,
    },
  ];

  console.log("");
  console.log("Verification results:");
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}`);
    console.log(`  ${check.details}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
    throw new Error(`Verification failed for ${failed.length} check(s).`);
  }

  console.log("");
  console.log("Verification complete.");
  console.log(`Share mint: ${asset.shareMint.toBase58()}`);
  console.log(`Reserve pool: ${asset.reservePool.toString()}`);
  console.log(`Sold shares: ${asset.soldShares.toString()}`);
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

function expandHome(filePath) {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function sha256Hex(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function assetPda(programId, id) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), u64le(id)],
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
