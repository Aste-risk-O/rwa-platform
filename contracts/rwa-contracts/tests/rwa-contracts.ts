import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { RwaContracts } from "../target/types/rwa_contracts";

const { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

const SHARE_PRICE_LAMPORTS = 1_000_000_000;
const TOTAL_SHARES = new anchor.BN(1_000);
const YIELD_RATE = new anchor.BN(86_400);
const BUY_AMOUNT = new anchor.BN(2);
const SELL_AMOUNT = new anchor.BN(1);
const DOC_HASH = Array.from({ length: 32 }, (_, i) => i + 1);
const ASSET_NAME = "Astana Coffee Shop";
const ASSET_URI = "https://example.com/assets/astana-coffee-shop.json";
const SECOND_ASSET_NAME = "Astana Bakery";
const SECOND_ASSET_URI = "https://example.com/assets/astana-bakery.json";

describe("rwa-contracts", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RwaContracts as Program<RwaContracts>;

  const admin = Keypair.generate();
  const buyer = Keypair.generate();

  const [marketplace] = PublicKey.findProgramAddressSync(
    [Buffer.from("marketplace")],
    program.programId
  );
  const asset0 = assetPda(program.programId, 0);
  const asset1 = assetPda(program.programId, 1);
  const shareMint0 = shareMintPda(program.programId, asset0);
  const userState0 = userPda(program.programId, asset0, buyer.publicKey);
  const buyerShares0 = getAssociatedTokenAddressSync(
    shareMint0,
    buyer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  before(async () => {
    await airdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
    await airdrop(buyer.publicKey, 10 * LAMPORTS_PER_SOL);
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const asset = (await program.account.assetState.fetch(asset0)) as any;
    const supply = await provider.connection.getTokenSupply(shareMint0);

    expect(asset.shareMint.toBase58()).to.eq(shareMint0.toBase58());
    expect(supply.value.amount).to.eq("0");
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

  async function airdrop(pubkey: anchor.web3.PublicKey, lamports: number) {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);

    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
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
