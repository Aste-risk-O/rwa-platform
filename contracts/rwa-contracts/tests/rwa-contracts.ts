import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getExtraAccountMetaAddress,
  getAssociatedTokenAddressSync,
  getMetadataPointerState,
  getMint,
  getTokenMetadata,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { RwaContracts } from "../target/types/rwa_contracts";
import { RwaTransferHook } from "../target/types/rwa_transfer_hook";

const { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

const SHARE_PRICE_LAMPORTS = 1_000_000_000;
const TOP_UP_AMOUNT = new anchor.BN(3_000_000_000);
const TOTAL_SHARES = new anchor.BN(1_000);
const YIELD_RATE = new anchor.BN(86_400);
const HIGH_RISK_YIELD_RATE = new anchor.BN("100000000000000");
const BUY_AMOUNT = new anchor.BN(2);
const SELL_AMOUNT = new anchor.BN(1);
const DOC_HASH = Array.from({ length: 32 }, (_, i) => i + 1);
const ASSET_NAME = "Astana Coffee Shop";
const ASSET_URI = "https://example.com/assets/astana-coffee-shop.json";
const SHARE_SYMBOL = "ACS";
const SECOND_ASSET_NAME = "Astana Bakery";
const SECOND_ASSET_URI = "https://example.com/assets/astana-bakery.json";
const THIRD_ASSET_NAME = "Astana Kiosk";
const THIRD_ASSET_URI = "https://example.com/assets/astana-kiosk.json";

describe("rwa-contracts", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RwaContracts as Program<RwaContracts>;
  const hookProgram = anchor.workspace.RwaTransferHook as Program<RwaTransferHook>;

  const admin = Keypair.generate();
  const buyer = Keypair.generate();
  const recipient = Keypair.generate();
  const outsider = Keypair.generate();

  const [marketplace] = PublicKey.findProgramAddressSync(
    [Buffer.from("marketplace")],
    program.programId
  );
  const asset0 = assetPda(program.programId, 0);
  const asset1 = assetPda(program.programId, 1);
  const asset2 = assetPda(program.programId, 2);
  const shareMint0 = shareMintPda(program.programId, asset0);
  const shareMint2 = shareMintPda(program.programId, asset2);
  const extraAccountMetaList0 = getExtraAccountMetaAddress(
    shareMint0,
    hookProgram.programId
  );
  const userState0 = userPda(program.programId, asset0, buyer.publicKey);
  const buyerShares0 = getAssociatedTokenAddressSync(
    shareMint0,
    buyer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const recipientUserState0 = userPda(program.programId, asset0, recipient.publicKey);
  const outsiderUserState0 = userPda(program.programId, asset0, outsider.publicKey);
  const recipientUserState2 = userPda(program.programId, asset2, recipient.publicKey);
  const recipientShares0 = getAssociatedTokenAddressSync(
    shareMint0,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const recipientShares2 = getAssociatedTokenAddressSync(
    shareMint2,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const outsiderShares0 = getAssociatedTokenAddressSync(
    shareMint0,
    outsider.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  before(async () => {
    await airdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
    await airdrop(buyer.publicKey, 10 * LAMPORTS_PER_SOL);
    await airdrop(recipient.publicKey, 10 * LAMPORTS_PER_SOL);
    await airdrop(outsider.publicKey, 10 * LAMPORTS_PER_SOL);
  });

  it("initialize_marketplace creates the marketplace state", async () => {
    await program.methods
      .initializeMarketplace()
      .accounts({
        marketplace,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const state = (await program.account.marketplaceState.fetch(marketplace)) as any;

    expect(state.admin.toBase58()).to.eq(admin.publicKey.toBase58());
    expect(state.nextAssetId.toString()).to.eq("0");
  });

  it("initialize_asset sets AssetState fields correctly", async () => {
    await program.methods
      .initializeAsset(TOTAL_SHARES, YIELD_RATE, DOC_HASH, ASSET_NAME, ASSET_URI)
      .accounts({
        marketplace,
        assetState: asset0,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const asset = (await program.account.assetState.fetch(asset0)) as any;
    const state = (await program.account.marketplaceState.fetch(marketplace)) as any;

    expect(asset.assetId.toString()).to.eq("0");
    expect(asset.totalShares.toString()).to.eq(TOTAL_SHARES.toString());
    expect(asset.soldShares.toString()).to.eq("0");
    expect(asset.yieldRate.toString()).to.eq(YIELD_RATE.toString());
    expect(asset.reservePool.toString()).to.eq("0");
    expect(Array.from(asset.documentHash)).to.deep.eq(DOC_HASH);
    expect(asset.assetName).to.eq(ASSET_NAME);
    expect(asset.assetUri).to.eq(ASSET_URI);
    expect(asset.admin.toBase58()).to.eq(admin.publicKey.toBase58());
    expect(state.nextAssetId.toString()).to.eq("1");
  });

  it("initialize_share_mint creates the Token-2022 share mint", async () => {
    await program.methods
      .initializeShareMint()
      .accounts({
        assetState: asset0,
        shareMint: shareMint0,
        admin: admin.publicKey,
        transferHookProgram: hookProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const asset = (await program.account.assetState.fetch(asset0)) as any;
    const mint = await waitForMint(shareMint0);
    const transferHook = getTransferHook(mint);
    const metadataPointer = getMetadataPointerState(mint);
    const supply = await provider.connection.getTokenSupply(shareMint0);

    expect(asset.shareMint.toBase58()).to.eq(shareMint0.toBase58());
    expect(transferHook?.programId.toBase58()).to.eq(hookProgram.programId.toBase58());
    expect(metadataPointer?.metadataAddress?.toBase58()).to.eq(shareMint0.toBase58());
    expect(supply.value.amount).to.eq("0");
  });

  it("initialize_share_metadata stores canonical Token-2022 metadata inside the mint", async () => {
    await program.methods
      .initializeShareMetadata(SHARE_SYMBOL)
      .accounts({
        assetState: asset0,
        shareMint: shareMint0,
        admin: admin.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const metadata = await waitForMetadata(shareMint0);

    expect(metadata).to.not.eq(null);
    expect(metadata?.mint.toBase58()).to.eq(shareMint0.toBase58());
    expect(metadata?.name).to.eq(`${ASSET_NAME} Shares`);
    expect(metadata?.symbol).to.eq(SHARE_SYMBOL);
    expect(metadata?.uri).to.eq(ASSET_URI);
    expect(metadata?.additionalMetadata).to.deep.include([
      "asset_id",
      "0",
    ]);
    expect(metadata?.additionalMetadata).to.deep.include([
      "document_hash",
      bytesToHex(DOC_HASH),
    ]);
  });

  it("configure_asset_hook writes the validation PDA for transfer-hook account resolution", async () => {
    await hookProgram.methods
      .configureAssetHook()
      .accounts({
        admin: admin.publicKey,
        extraAccountMetaList: extraAccountMetaList0,
        shareMint: shareMint0,
        assetState: asset0,
        rwaContractsProgram: program.programId,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const metaAccount = await provider.connection.getAccountInfo(extraAccountMetaList0);

    expect(metaAccount).to.not.eq(null);
    expect(metaAccount?.owner.toBase58()).to.eq(hookProgram.programId.toBase58());
  });

  it("add_to_whitelist sets UserState.is_whitelisted to true", async () => {
    await program.methods
      .addToWhitelist(buyer.publicKey)
      .accounts({
        assetState: asset0,
        userState: userState0,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const user = (await program.account.userState.fetch(userState0)) as any;

    expect(user.wallet.toBase58()).to.eq(buyer.publicKey.toBase58());
    expect(user.isWhitelisted).to.eq(true);
    expect(user.sharesOwned.toString()).to.eq("0");
  });

  it("add_to_whitelist can approve a second holder for future compliance checks", async () => {
    await program.methods
      .addToWhitelist(recipient.publicKey)
      .accounts({
        assetState: asset0,
        userState: recipientUserState0,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const user = (await program.account.userState.fetch(recipientUserState0)) as any;
    expect(user.isWhitelisted).to.eq(true);
  });

  it("set_whitelist_status can register an explicitly blocked wallet", async () => {
    await program.methods
      .setWhitelistStatus(outsider.publicKey, false)
      .accounts({
        assetState: asset0,
        userState: outsiderUserState0,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const user = (await program.account.userState.fetch(outsiderUserState0)) as any;
    expect(user.isWhitelisted).to.eq(false);
  });

  it("reserve_top_up increases reserve_pool and the asset lamport balance", async () => {
    const beforeAsset = (await program.account.assetState.fetch(asset0)) as any;
    const beforeLamports = await provider.connection.getBalance(asset0);

    await program.methods
      .reserveTopUp(TOP_UP_AMOUNT)
      .accounts({
        assetState: asset0,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const afterAsset = (await program.account.assetState.fetch(asset0)) as any;
    const afterLamports = await provider.connection.getBalance(asset0);

    expect(afterAsset.reservePool.toString()).to.eq(
      beforeAsset.reservePool.add(TOP_UP_AMOUNT).toString()
    );
    expect(afterLamports - beforeLamports).to.eq(TOP_UP_AMOUNT.toNumber());
  });

  it("buy_shares rejects a wallet that has an explicit non-whitelisted state", async () => {
    await expectRpcFailure(
      program.methods
        .buyShares(new anchor.BN(1))
        .accounts({
          assetState: asset0,
          userState: outsiderUserState0,
          shareMint: shareMint0,
          buyerShares: outsiderShares0,
          buyer: outsider.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([outsider])
        .rpc(),
      "Wallet is not whitelisted"
    );
  });

  it("buy_shares increases shares_owned, reserve_pool, and token balance", async () => {
    const beforeAsset = (await program.account.assetState.fetch(asset0)) as any;
    const beforeUser = (await program.account.userState.fetch(userState0)) as any;
    const beforeSupply = await provider.connection.getTokenSupply(shareMint0);

    await program.methods
      .buyShares(BUY_AMOUNT)
      .accounts({
        assetState: asset0,
        userState: userState0,
        shareMint: shareMint0,
        buyerShares: buyerShares0,
        buyer: buyer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const afterAsset = (await program.account.assetState.fetch(asset0)) as any;
    const afterUser = (await program.account.userState.fetch(userState0)) as any;
    const tokenBal = await provider.connection.getTokenAccountBalance(buyerShares0);
    const afterSupply = await provider.connection.getTokenSupply(shareMint0);
    const cost = BUY_AMOUNT.mul(new anchor.BN(SHARE_PRICE_LAMPORTS));

    expect(afterUser.sharesOwned.toString()).to.eq(
      beforeUser.sharesOwned.add(BUY_AMOUNT).toString()
    );
    expect(afterAsset.soldShares.toString()).to.eq(
      beforeAsset.soldShares.add(BUY_AMOUNT).toString()
    );
    expect(afterAsset.reservePool.toString()).to.eq(
      beforeAsset.reservePool.add(cost).toString()
    );
    expect(afterUser.lastClaimTimestamp.toNumber()).to.be.greaterThan(0);
    expect(tokenBal.value.amount).to.eq(BUY_AMOUNT.toString());
    expect(afterSupply.value.amount).to.eq(
      new anchor.BN(beforeSupply.value.amount).add(BUY_AMOUNT).toString()
    );
  });

  it("claim_yield advances time and pays the correct yield", async () => {
    const beforeUser = (await program.account.userState.fetch(userState0)) as any;
    const beforeAsset = (await program.account.assetState.fetch(asset0)) as any;
    const beforeBal = await provider.connection.getBalance(buyer.publicKey);

    let afterUser = beforeUser;

    for (let i = 0; i < 5; i += 1) {
      await sleep(1_200);

      await program.methods
        .claimYield()
        .accounts({
          assetState: asset0,
          userState: userState0,
          user: buyer.publicKey,
        })
        .signers([buyer])
        .rpc();

      afterUser = (await program.account.userState.fetch(userState0)) as any;
      if (
        afterUser.lastClaimTimestamp.toNumber() >
        beforeUser.lastClaimTimestamp.toNumber()
      ) {
        break;
      }
    }

    expect(afterUser.lastClaimTimestamp.toNumber()).to.be.greaterThan(
      beforeUser.lastClaimTimestamp.toNumber()
    );

    const afterAsset = (await program.account.assetState.fetch(asset0)) as any;
    const afterBal = await provider.connection.getBalance(buyer.publicKey);
    const elapsed =
      afterUser.lastClaimTimestamp.toNumber() -
      beforeUser.lastClaimTimestamp.toNumber();
    const expectedYield = new anchor.BN(elapsed)
      .mul(beforeUser.sharesOwned)
      .mul(YIELD_RATE)
      .div(new anchor.BN(86_400));

    expect(expectedYield.gt(new anchor.BN(0))).to.eq(true);
    expect(afterAsset.reservePool.toString()).to.eq(
      beforeAsset.reservePool.sub(expectedYield).toString()
    );
    expect(afterBal - beforeBal).to.eq(expectedYield.toNumber());
  });

  it("instant_sell decreases shares_owned and burns share tokens before payout", async () => {
    const beforeUser = (await program.account.userState.fetch(userState0)) as any;
    const beforeAsset = (await program.account.assetState.fetch(asset0)) as any;
    const beforeBal = await provider.connection.getBalance(buyer.publicKey);
    const beforeSupply = await provider.connection.getTokenSupply(shareMint0);

    await program.methods
      .instantSell(SELL_AMOUNT)
      .accounts({
        assetState: asset0,
        userState: userState0,
        shareMint: shareMint0,
        userShares: buyerShares0,
        user: buyer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const afterUser = (await program.account.userState.fetch(userState0)) as any;
    const afterAsset = (await program.account.assetState.fetch(asset0)) as any;
    const afterBal = await provider.connection.getBalance(buyer.publicKey);
    const tokenBal = await provider.connection.getTokenAccountBalance(buyerShares0);
    const afterSupply = await provider.connection.getTokenSupply(shareMint0);
    const payout = SELL_AMOUNT.mul(new anchor.BN(SHARE_PRICE_LAMPORTS))
      .mul(new anchor.BN(90))
      .div(new anchor.BN(100));

    expect(afterUser.sharesOwned.toString()).to.eq(
      beforeUser.sharesOwned.sub(SELL_AMOUNT).toString()
    );
    expect(afterAsset.soldShares.toString()).to.eq(
      beforeAsset.soldShares.sub(SELL_AMOUNT).toString()
    );
    expect(afterAsset.reservePool.toString()).to.eq(
      beforeAsset.reservePool.sub(payout).toString()
    );
    expect(afterBal - beforeBal).to.eq(payout.toNumber());
    expect(tokenBal.value.amount).to.eq(
      beforeUser.sharesOwned.sub(SELL_AMOUNT).toString()
    );
    expect(afterSupply.value.amount).to.eq(
      new anchor.BN(beforeSupply.value.amount).sub(SELL_AMOUNT).toString()
    );
  });

  it("instant_sell rejects a whitelisted wallet that does not own any shares", async () => {
    await ensureAta(recipient.publicKey, recipientShares0, shareMint0);

    await expectRpcFailure(
      program.methods
        .instantSell(new anchor.BN(1))
        .accounts({
          assetState: asset0,
          userState: recipientUserState0,
          shareMint: shareMint0,
          userShares: recipientShares0,
          user: recipient.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc(),
      "Insufficient funds"
    );
  });

  it("transfer hook rejects direct transfers to a non-whitelisted recipient", async () => {
    await ensureAta(outsider.publicKey, outsiderShares0);

    const ix = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      buyerShares0,
      shareMint0,
      outsiderShares0,
      buyer.publicKey,
      1n,
      0,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    await expectRpcFailure(sendSigned(ix, [buyer]), "Recipient wallet is not whitelisted");
  });

  it("transfer hook blocks direct secondary transfers even for whitelisted recipients", async () => {
    await ensureAta(recipient.publicKey, recipientShares0);

    const ix = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      buyerShares0,
      shareMint0,
      recipientShares0,
      buyer.publicKey,
      1n,
      0,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    await expectRpcFailure(
      sendSigned(ix, [buyer]),
      "Direct secondary transfers are disabled"
    );
  });

  it("initialize_asset can add another marketplace asset", async () => {
    await program.methods
      .initializeAsset(
        new anchor.BN(500),
        new anchor.BN(43_200),
        DOC_HASH.map((v) => 255 - v),
        SECOND_ASSET_NAME,
        SECOND_ASSET_URI
      )
      .accounts({
        marketplace,
        assetState: asset1,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const asset = (await program.account.assetState.fetch(asset1)) as any;
    const state = (await program.account.marketplaceState.fetch(marketplace)) as any;

    expect(asset.assetId.toString()).to.eq("1");
    expect(asset.assetName).to.eq(SECOND_ASSET_NAME);
    expect(asset.assetUri).to.eq(SECOND_ASSET_URI);
    expect(state.nextAssetId.toString()).to.eq("2");
  });

  it("claim_yield rejects when accrued yield is larger than the reserve pool", async () => {
    await program.methods
      .initializeAsset(
        new anchor.BN(10),
        HIGH_RISK_YIELD_RATE,
        DOC_HASH.map((v) => (v + 7) % 256),
        THIRD_ASSET_NAME,
        THIRD_ASSET_URI
      )
      .accounts({
        marketplace,
        assetState: asset2,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    await program.methods
      .initializeShareMint()
      .accounts({
        assetState: asset2,
        shareMint: shareMint2,
        admin: admin.publicKey,
        transferHookProgram: hookProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    await program.methods
      .addToWhitelist(recipient.publicKey)
      .accounts({
        assetState: asset2,
        userState: recipientUserState2,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    await program.methods
      .buyShares(new anchor.BN(1))
      .accounts({
        assetState: asset2,
        userState: recipientUserState2,
        shareMint: shareMint2,
        buyerShares: recipientShares2,
        buyer: recipient.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([recipient])
      .rpc();

    await sleep(1_200);

    await expectRpcFailure(
      program.methods
        .claimYield()
        .accounts({
          assetState: asset2,
          userState: recipientUserState2,
          user: recipient.publicKey,
        })
        .signers([recipient])
        .rpc(),
      "Insufficient reserve"
    );
  });

  async function airdrop(pubkey: anchor.web3.PublicKey, lamports: number) {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);

    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForMint(mint: PublicKey) {
    let lastError: unknown;

    for (let i = 0; i < 10; i += 1) {
      try {
        return await getMint(
          provider.connection,
          mint,
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );
      } catch (error) {
        lastError = error;
        await sleep(300);
      }
    }

    throw lastError;
  }

  async function waitForMetadata(mint: PublicKey) {
    for (let i = 0; i < 10; i += 1) {
      const metadata = await getTokenMetadata(
        provider.connection,
        mint,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      if (metadata) {
        return metadata;
      }

      await sleep(300);
    }

    return null;
  }

  async function ensureAta(owner: PublicKey, ata: PublicKey, mint = shareMint0) {
    const info = await provider.connection.getAccountInfo(ata);
    if (info) {
      return;
    }

    const ix = createAssociatedTokenAccountIdempotentInstruction(
      admin.publicKey,
      ata,
      owner,
      mint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await sendSigned(ix, [admin]);
  }

  async function sendSigned(
    instruction: anchor.web3.TransactionInstruction,
    signers: anchor.web3.Signer[]
  ) {
    const tx = new anchor.web3.Transaction().add(instruction);
    return provider.sendAndConfirm(tx, signers);
  }

  async function expectRpcFailure(promise: Promise<unknown>, message: string) {
    try {
      await promise;
      expect.fail(`expected transaction to fail with: ${message}`);
    } catch (error: any) {
      expect(String(error)).to.include(message);
    }
  }
});

function assetPda(programId: PublicKey, id: number) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), u64le(id)],
    programId
  )[0];
}

function shareMintPda(programId: PublicKey, asset: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), asset.toBuffer()],
    programId
  )[0];
}

function userPda(programId: PublicKey, asset: PublicKey, wallet: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), asset.toBuffer(), wallet.toBuffer()],
    programId
  )[0];
}

  function u64le(n: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function bytesToHex(bytes: number[]) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
