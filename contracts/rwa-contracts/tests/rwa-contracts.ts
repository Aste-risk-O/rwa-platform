import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
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

describe("rwa-contracts", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RwaContracts as Program<RwaContracts>;

  const admin = Keypair.generate();
  const buyer = Keypair.generate();

  const [assetState] = PublicKey.findProgramAddressSync(
    [Buffer.from("asset")],
    program.programId
  );
  const [userState] = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), buyer.publicKey.toBuffer()],
    program.programId
  );

  before(async () => {
    await airdrop(admin.publicKey, 5 * LAMPORTS_PER_SOL);
    await airdrop(buyer.publicKey, 5 * LAMPORTS_PER_SOL);
  });

  it("initialize_asset sets AssetState fields correctly", async () => {
    await program.methods
      .initializeAsset(TOTAL_SHARES, YIELD_RATE, DOC_HASH, ASSET_NAME, ASSET_URI)
      .accounts({
        assetState,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const asset = (await program.account.assetState.fetch(assetState)) as any;

    expect(asset.totalShares.toString()).to.eq(TOTAL_SHARES.toString());
    expect(asset.soldShares.toString()).to.eq("0");
    expect(asset.yieldRate.toString()).to.eq(YIELD_RATE.toString());
    expect(asset.reservePool.toString()).to.eq("0");
    expect(Array.from(asset.documentHash)).to.deep.eq(DOC_HASH);
    expect(asset.assetName).to.eq(ASSET_NAME);
    expect(asset.assetUri).to.eq(ASSET_URI);
    expect(asset.admin.toBase58()).to.eq(admin.publicKey.toBase58());
  });

  it("add_to_whitelist sets UserState.is_whitelisted to true", async () => {
    await program.methods
      .addToWhitelist(buyer.publicKey)
      .accounts({
        assetState,
        userState,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const user = (await program.account.userState.fetch(userState)) as any;

    expect(user.wallet.toBase58()).to.eq(buyer.publicKey.toBase58());
    expect(user.isWhitelisted).to.eq(true);
    expect(user.sharesOwned.toString()).to.eq("0");
  });

  it("buy_shares increases shares_owned and reserve_pool", async () => {
    const beforeAsset = (await program.account.assetState.fetch(assetState)) as any;
    const beforeUser = (await program.account.userState.fetch(userState)) as any;

    await program.methods
      .buyShares(BUY_AMOUNT)
      .accounts({
        assetState,
        userState,
        buyer: buyer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const afterAsset = (await program.account.assetState.fetch(assetState)) as any;
    const afterUser = (await program.account.userState.fetch(userState)) as any;
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
  });

  it("claim_yield advances time and pays the correct yield", async () => {
    const beforeUser = (await program.account.userState.fetch(userState)) as any;
    const beforeAsset = (await program.account.assetState.fetch(assetState)) as any;
    const beforeBal = await provider.connection.getBalance(buyer.publicKey);

    let afterUser = beforeUser;

    for (let i = 0; i < 5; i += 1) {
      await sleep(1_200);

      await program.methods
        .claimYield()
        .accounts({
          assetState,
          userState,
          user: buyer.publicKey,
        })
        .signers([buyer])
        .rpc();

      afterUser = (await program.account.userState.fetch(userState)) as any;
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

    const afterAsset = (await program.account.assetState.fetch(assetState)) as any;
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

  it("instant_sell decreases shares_owned and pays 90% of share price", async () => {
    const beforeUser = (await program.account.userState.fetch(userState)) as any;
    const beforeAsset = (await program.account.assetState.fetch(assetState)) as any;
    const beforeBal = await provider.connection.getBalance(buyer.publicKey);

    await program.methods
      .instantSell(SELL_AMOUNT)
      .accounts({
        assetState,
        userState,
        user: buyer.publicKey,
      })
      .signers([buyer])
      .rpc();

    const afterUser = (await program.account.userState.fetch(userState)) as any;
    const afterAsset = (await program.account.assetState.fetch(assetState)) as any;
    const afterBal = await provider.connection.getBalance(buyer.publicKey);
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
  });

  async function airdrop(pubkey: anchor.web3.PublicKey, lamports: number) {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);

    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
});
