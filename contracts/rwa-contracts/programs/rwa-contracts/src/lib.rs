use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

declare_id!("AH6kQ9Uz3Pzizt7hLwjpKhTFRCK5yS3pMjHSVAAaGasB");

const SHARE_PRICE_LAMPORTS: u64 = 1_000_000_000;
const SECONDS_PER_DAY: u64 = 86_400;

#[program]
pub mod rwa_contracts {
    use super::*;

    pub fn initialize_asset(
        ctx: Context<InitializeAsset>,
        total_shares: u64,
        yield_rate: u64,
        document_hash: [u8; 32],
        asset_name: String,
        asset_uri: String,
    ) -> Result<()> {
        let acc = &mut ctx.accounts.asset_state;

        acc.total_shares = total_shares;
        acc.sold_shares = 0;
        acc.yield_rate = yield_rate;
        acc.reserve_pool = 0;
        acc.document_hash = document_hash;
        acc.asset_name = asset_name;
        acc.asset_uri = asset_uri;
        acc.admin = ctx.accounts.admin.key();
        acc.bump = ctx.bumps.asset_state;

        Ok(())
    }

    pub fn add_to_whitelist(ctx: Context<AddToWhitelist>, wallet: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.asset_state.admin,
            RwaError::AdminOnly
        );

        let acc = &mut ctx.accounts.user_state;

        acc.wallet = wallet;
        acc.shares_owned = 0;
        acc.last_claim_timestamp = 0;
        acc.is_whitelisted = true;
        acc.bump = ctx.bumps.user_state;

        Ok(())
    }

    pub fn buy_shares(ctx: Context<BuyShares>, amount: u64) -> Result<()> {
        require!(ctx.accounts.user_state.is_whitelisted, RwaError::NotWhitelisted);

        let available = ctx
            .accounts
            .asset_state
            .total_shares
            .checked_sub(ctx.accounts.asset_state.sold_shares)
            .ok_or(RwaError::InsufficientFunds)?;
        require!(available >= amount, RwaError::InsufficientFunds);

        let pay = amount
            .checked_mul(SHARE_PRICE_LAMPORTS)
            .ok_or(RwaError::InsufficientFunds)?;

        let cpi = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.asset_state.to_account_info(),
            },
        );
        system_program::transfer(cpi, pay)?;

        let ts = Clock::get()?.unix_timestamp;
        let asset = &mut ctx.accounts.asset_state;
        let user = &mut ctx.accounts.user_state;

        user.shares_owned = user
            .shares_owned
            .checked_add(amount)
            .ok_or(RwaError::InsufficientFunds)?;
        user.last_claim_timestamp = ts;

        asset.sold_shares = asset
            .sold_shares
            .checked_add(amount)
            .ok_or(RwaError::InsufficientFunds)?;
        asset.reserve_pool = asset
            .reserve_pool
            .checked_add(pay)
            .ok_or(RwaError::InsufficientReserve)?;

        Ok(())
    }

    pub fn claim_yield(ctx: Context<ClaimYield>) -> Result<()> {
        let ts = Clock::get()?.unix_timestamp;
        let elapsed = ts.saturating_sub(ctx.accounts.user_state.last_claim_timestamp);
        let elapsed = u64::try_from(elapsed).unwrap_or(0);

        let amt = elapsed
            .checked_mul(ctx.accounts.user_state.shares_owned)
            .and_then(|v| v.checked_mul(ctx.accounts.asset_state.yield_rate))
            .and_then(|v| v.checked_div(SECONDS_PER_DAY))
            .ok_or(RwaError::InsufficientReserve)?;

        require!(
            ctx.accounts.asset_state.reserve_pool >= amt,
            RwaError::InsufficientReserve
        );

        move_lamports(
            &ctx.accounts.asset_state.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            amt,
        )?;

        let asset = &mut ctx.accounts.asset_state;
        let user = &mut ctx.accounts.user_state;

        user.last_claim_timestamp = ts;
        asset.reserve_pool = asset
            .reserve_pool
            .checked_sub(amt)
            .ok_or(RwaError::InsufficientReserve)?;

        Ok(())
    }

    pub fn instant_sell(ctx: Context<InstantSell>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.user_state.shares_owned >= amount,
            RwaError::InsufficientFunds
        );

        let payout = amount
            .checked_mul(SHARE_PRICE_LAMPORTS)
            .and_then(|v| v.checked_mul(90))
            .and_then(|v| v.checked_div(100))
            .ok_or(RwaError::InsufficientReserve)?;

        require!(
            ctx.accounts.asset_state.reserve_pool >= payout,
            RwaError::InsufficientReserve
        );

        move_lamports(
            &ctx.accounts.asset_state.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            payout,
        )?;

        let asset = &mut ctx.accounts.asset_state;
        let user = &mut ctx.accounts.user_state;

        asset.reserve_pool = asset
            .reserve_pool
            .checked_sub(payout)
            .ok_or(RwaError::InsufficientReserve)?;
        user.shares_owned = user
            .shares_owned
            .checked_sub(amount)
            .ok_or(RwaError::InsufficientFunds)?;
        asset.sold_shares = asset
            .sold_shares
            .checked_sub(amount)
            .ok_or(RwaError::InsufficientFunds)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeAsset<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + AssetState::LEN,
        seeds = [b"asset"],
        bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct AddToWhitelist<'info> {
    #[account(
        mut,
        seeds = [b"asset"],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        init,
        payer = admin,
        space = 8 + UserState::LEN,
        seeds = [b"user", wallet.as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyShares<'info> {
    #[account(
        mut,
        seeds = [b"asset"],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        mut,
        seeds = [b"user", buyer.key().as_ref()],
        bump = user_state.bump,
        constraint = user_state.wallet == buyer.key()
    )]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimYield<'info> {
    #[account(
        mut,
        seeds = [b"asset"],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_state.bump,
        constraint = user_state.wallet == user.key()
    )]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct InstantSell<'info> {
    #[account(
        mut,
        seeds = [b"asset"],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_state.bump,
        constraint = user_state.wallet == user.key()
    )]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[account]
pub struct AssetState {
    pub total_shares: u64,
    pub sold_shares: u64,
    pub yield_rate: u64,
    pub reserve_pool: u64,
    pub document_hash: [u8; 32],
    pub asset_name: String,
    pub asset_uri: String,
    pub admin: Pubkey,
    pub bump: u8,
}

#[account]
pub struct UserState {
    pub wallet: Pubkey,
    pub shares_owned: u64,
    pub last_claim_timestamp: i64,
    pub is_whitelisted: bool,
    pub bump: u8,
}

#[error_code]
pub enum RwaError {
    #[msg("Wallet is not whitelisted")]
    NotWhitelisted,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Insufficient reserve")]
    InsufficientReserve,
    #[msg("Admin only")]
    AdminOnly,
}

impl AssetState {
    pub const MAX_NAME_LEN: usize = 128;
    pub const MAX_URI_LEN: usize = 256;
    pub const LEN: usize = 8
        + 8
        + 8
        + 8
        + 32
        + 4 + Self::MAX_NAME_LEN
        + 4 + Self::MAX_URI_LEN
        + 32
        + 1;
}

impl UserState {
    pub const LEN: usize = 32
        + 8
        + 8
        + 1
        + 1;
}

fn move_lamports(from: &AccountInfo<'_>, to: &AccountInfo<'_>, amt: u64) -> Result<()> {
    require!(from.lamports() >= amt, RwaError::InsufficientReserve);

    let next_from = from
        .lamports()
        .checked_sub(amt)
        .ok_or(RwaError::InsufficientReserve)?;
    let next_to = to
        .lamports()
        .checked_add(amt)
        .ok_or(RwaError::InsufficientReserve)?;

    **from.try_borrow_mut_lamports()? = next_from;
    **to.try_borrow_mut_lamports()? = next_to;

    Ok(())
}
