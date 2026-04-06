use anchor_lang::{
    prelude::*,
    solana_program::{
        program::{invoke, invoke_signed},
        system_instruction,
    },
    system_program::{self, Transfer},
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Burn, Mint, MintTo, TokenAccount, TokenInterface},
};
use spl_token_2022::{
    extension::metadata_pointer::instruction as metadata_pointer_instruction,
    extension::transfer_hook::instruction as transfer_hook_instruction,
    instruction as token_2022_instruction,
};
use spl_token_metadata_interface::{
    instruction as token_metadata_instruction,
    state::Field as TokenMetadataField,
};

declare_id!("AH6kQ9Uz3Pzizt7hLwjpKhTFRCK5yS3pMjHSVAAaGasB");

const SHARE_PRICE_LAMPORTS: u64 = 1_000_000_000;
const SECONDS_PER_DAY: u64 = 86_400;
// Supports:
// - TransferHook extension
// - MetadataPointer extension
const SHARE_MINT_BASE_ACCOUNT_LEN: usize = 302;
// Overfund mint rent up front so Token-2022 can later grow the account during
// metadata initialization without requiring a second payer transfer.
// Sized for in-mint TokenMetadata entry with:
//   * name <= 135 chars
//   * symbol <= 16 chars
//   * uri <= 256 chars
//   * additional fields: asset_id, document_hash
const SHARE_MINT_ACCOUNT_MAX_LEN: usize = 914;
const SHARE_METADATA_SYMBOL_MAX_LEN: usize = 16;
pub const RWA_TRANSFER_HOOK_ID: Pubkey = pubkey!("46Qyj9daA4R3gRuEJzVCDuJX43An4oz4PsdzUXjV3sG8");

#[program]
pub mod rwa_contracts {
    use super::*;

    pub fn initialize_marketplace(ctx: Context<InitializeMarketplace>) -> Result<()> {
        let acc = &mut ctx.accounts.marketplace;

        acc.admin = ctx.accounts.admin.key();
        acc.next_asset_id = 0;
        acc.bump = ctx.bumps.marketplace;

        Ok(())
    }

    pub fn initialize_asset(
        ctx: Context<InitializeAsset>,
        total_shares: u64,
        yield_rate: u64,
        document_hash: [u8; 32],
        asset_name: String,
        asset_uri: String,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.marketplace.admin,
            RwaError::AdminOnly
        );

        let id = ctx.accounts.marketplace.next_asset_id;
        let acc = &mut ctx.accounts.asset_state;

        acc.asset_id = id;
        acc.total_shares = total_shares;
        acc.sold_shares = 0;
        acc.yield_rate = yield_rate;
        acc.reserve_pool = 0;
        acc.document_hash = document_hash;
        acc.asset_name = asset_name;
        acc.asset_uri = asset_uri;
        acc.admin = ctx.accounts.admin.key();
        acc.share_mint = Pubkey::default();
        acc.bump = ctx.bumps.asset_state;
        acc.share_mint_bump = 0;

        ctx.accounts.marketplace.next_asset_id = ctx
            .accounts
            .marketplace
            .next_asset_id
            .checked_add(1)
            .ok_or(RwaError::InsufficientFunds)?;

        Ok(())
    }

    pub fn initialize_share_mint(ctx: Context<InitializeShareMint>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.asset_state.admin,
            RwaError::AdminOnly
        );
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            anchor_spl::token_2022::ID,
            RwaError::InvalidTokenProgram
        );
        require_keys_eq!(
            ctx.accounts.transfer_hook_program.key(),
            RWA_TRANSFER_HOOK_ID,
            RwaError::InvalidTransferHookProgram
        );
        require!(
            ctx.accounts.share_mint.lamports() == 0,
            RwaError::ShareMintAlreadyInitialized
        );

        // The mint must be allocated with enough space for the TransferHook
        // extension before Token-2022 initialization runs.
        let rent_lamports = Rent::get()?.minimum_balance(SHARE_MINT_ACCOUNT_MAX_LEN);
        let asset_state_key = ctx.accounts.asset_state.key();
        let signer_seeds: &[&[u8]] = &[
            b"share_mint".as_ref(),
            asset_state_key.as_ref(),
            &[ctx.bumps.share_mint],
        ];

        invoke_signed(
            &system_instruction::create_account(
                &ctx.accounts.admin.key(),
                &ctx.accounts.share_mint.key(),
                rent_lamports,
                SHARE_MINT_BASE_ACCOUNT_LEN as u64,
                &ctx.accounts.token_program.key(),
            ),
            &[
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.share_mint.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        invoke(
            &transfer_hook_instruction::initialize(
                &ctx.accounts.token_program.key(),
                &ctx.accounts.share_mint.key(),
                Some(ctx.accounts.admin.key()),
                Some(ctx.accounts.transfer_hook_program.key()),
            )?,
            &[
                ctx.accounts.share_mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        invoke(
            &metadata_pointer_instruction::initialize(
                &ctx.accounts.token_program.key(),
                &ctx.accounts.share_mint.key(),
                Some(ctx.accounts.admin.key()),
                Some(ctx.accounts.share_mint.key()),
            )?,
            &[
                ctx.accounts.share_mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        invoke(
            &token_2022_instruction::initialize_mint2(
                &ctx.accounts.token_program.key(),
                &ctx.accounts.share_mint.key(),
                &ctx.accounts.asset_state.key(),
                Some(&ctx.accounts.asset_state.key()),
                0,
            )?,
            &[
                ctx.accounts.share_mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        let acc = &mut ctx.accounts.asset_state;
        acc.share_mint = ctx.accounts.share_mint.key();
        acc.share_mint_bump = ctx.bumps.share_mint;

        Ok(())
    }

    pub fn initialize_share_metadata(
        ctx: Context<InitializeShareMetadata>,
        symbol: String,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.asset_state.admin,
            RwaError::AdminOnly
        );
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            anchor_spl::token_2022::ID,
            RwaError::InvalidTokenProgram
        );
        require_keys_eq!(
            ctx.accounts.asset_state.share_mint,
            ctx.accounts.share_mint.key(),
            RwaError::InvalidShareMint
        );
        require!(
            !symbol.is_empty() && symbol.len() <= SHARE_METADATA_SYMBOL_MAX_LEN,
            RwaError::InvalidMetadataSymbol
        );

        let asset = &ctx.accounts.asset_state;
        let metadata_name = format!("{} Shares", asset.asset_name);
        let asset_signer_seeds: &[&[u8]] = &[
            b"asset".as_ref(),
            &asset.asset_id.to_le_bytes(),
            &[asset.bump],
        ];
        let asset_signer = &[asset_signer_seeds];

        invoke_signed(
            &token_metadata_instruction::initialize(
                &ctx.accounts.token_program.key(),
                &ctx.accounts.share_mint.key(),
                &ctx.accounts.admin.key(),
                &ctx.accounts.share_mint.key(),
                &ctx.accounts.asset_state.key(),
                metadata_name,
                symbol,
                asset.asset_uri.clone(),
            ),
            &[
                ctx.accounts.share_mint.to_account_info(),
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.share_mint.to_account_info(),
                ctx.accounts.asset_state.to_account_info(),
            ],
            asset_signer,
        )?;

        invoke(
            &token_metadata_instruction::update_field(
                &ctx.accounts.token_program.key(),
                &ctx.accounts.share_mint.key(),
                &ctx.accounts.admin.key(),
                TokenMetadataField::Key("asset_id".to_string()),
                asset.asset_id.to_string(),
            ),
            &[
                ctx.accounts.share_mint.to_account_info(),
                ctx.accounts.admin.to_account_info(),
            ],
        )?;

        invoke(
            &token_metadata_instruction::update_field(
                &ctx.accounts.token_program.key(),
                &ctx.accounts.share_mint.key(),
                &ctx.accounts.admin.key(),
                TokenMetadataField::Key("document_hash".to_string()),
                bytes_to_hex(&asset.document_hash),
            ),
            &[
                ctx.accounts.share_mint.to_account_info(),
                ctx.accounts.admin.to_account_info(),
            ],
        )?;

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

    pub fn set_whitelist_status(
        ctx: Context<SetWhitelistStatus>,
        wallet: Pubkey,
        is_whitelisted: bool,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.asset_state.admin,
            RwaError::AdminOnly
        );

        let acc = &mut ctx.accounts.user_state;

        if acc.wallet == Pubkey::default() {
            acc.wallet = wallet;
            acc.shares_owned = 0;
            acc.last_claim_timestamp = 0;
            acc.bump = ctx.bumps.user_state;
        } else {
            require_keys_eq!(acc.wallet, wallet, RwaError::InvalidUserState);
        }

        acc.is_whitelisted = is_whitelisted;

        Ok(())
    }

    pub fn reserve_top_up(ctx: Context<ReserveTopUp>, amount: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.asset_state.admin,
            RwaError::AdminOnly
        );

        let pay_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.admin.to_account_info(),
                to: ctx.accounts.asset_state.to_account_info(),
            },
        );
        system_program::transfer(pay_ctx, amount)?;

        let asset = &mut ctx.accounts.asset_state;
        asset.reserve_pool = asset
            .reserve_pool
            .checked_add(amount)
            .ok_or(RwaError::InsufficientReserve)?;

        Ok(())
    }

    pub fn buy_shares(ctx: Context<BuyShares>, amount: u64) -> Result<()> {
        require!(ctx.accounts.user_state.is_whitelisted, RwaError::NotWhitelisted);
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            anchor_spl::token_2022::ID,
            RwaError::InvalidTokenProgram
        );
        require_keys_eq!(
            ctx.accounts.asset_state.share_mint,
            ctx.accounts.share_mint.key(),
            RwaError::InvalidShareMint
        );

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

        let pay_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.asset_state.to_account_info(),
            },
        );
        system_program::transfer(pay_ctx, pay)?;

        let seeds: &[&[u8]] = &[
            b"asset".as_ref(),
            &ctx.accounts.asset_state.asset_id.to_le_bytes(),
            &[ctx.accounts.asset_state.bump],
        ];
        let signer = &[seeds];
        let mint_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.buyer_shares.to_account_info(),
                authority: ctx.accounts.asset_state.to_account_info(),
            },
        )
        .with_signer(signer);
        token_interface::mint_to(mint_ctx, amount)?;

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
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            anchor_spl::token_2022::ID,
            RwaError::InvalidTokenProgram
        );
        require_keys_eq!(
            ctx.accounts.asset_state.share_mint,
            ctx.accounts.share_mint.key(),
            RwaError::InvalidShareMint
        );
        require!(
            ctx.accounts.user_shares.amount >= amount,
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

        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.user_shares.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token_interface::burn(burn_ctx, amount)?;

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
pub struct InitializeMarketplace<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + MarketplaceState::LEN,
        seeds = [b"marketplace"],
        bump
    )]
    pub marketplace: Account<'info, MarketplaceState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeAsset<'info> {
    #[account(
        mut,
        seeds = [b"marketplace"],
        bump = marketplace.bump
    )]
    pub marketplace: Account<'info, MarketplaceState>,
    #[account(
        init,
        payer = admin,
        space = 8 + AssetState::LEN,
        seeds = [b"asset".as_ref(), &marketplace.next_asset_id.to_le_bytes()],
        bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeShareMint<'info> {
    #[account(
        mut,
        seeds = [b"asset".as_ref(), &asset_state.asset_id.to_le_bytes()],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    /// CHECK: The account is created and initialized manually to allocate
    /// enough bytes for Token-2022 extensions.
    #[account(
        mut,
        seeds = [b"share_mint".as_ref(), asset_state.key().as_ref()],
        bump
    )]
    pub share_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: This must be the deployed transfer-hook program used by every
    /// share mint in the marketplace.
    #[account(address = RWA_TRANSFER_HOOK_ID)]
    pub transfer_hook_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct AddToWhitelist<'info> {
    #[account(
        mut,
        seeds = [b"asset".as_ref(), &asset_state.asset_id.to_le_bytes()],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        init,
        payer = admin,
        space = 8 + UserState::LEN,
        seeds = [b"user".as_ref(), asset_state.key().as_ref(), wallet.as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeShareMetadata<'info> {
    #[account(
        mut,
        seeds = [b"asset".as_ref(), &asset_state.asset_id.to_le_bytes()],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        mut,
        seeds = [b"share_mint".as_ref(), asset_state.key().as_ref()],
        bump = asset_state.share_mint_bump
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct BuyShares<'info> {
    #[account(
        mut,
        seeds = [b"asset".as_ref(), &asset_state.asset_id.to_le_bytes()],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        mut,
        seeds = [b"user".as_ref(), asset_state.key().as_ref(), buyer.key().as_ref()],
        bump = user_state.bump,
        constraint = user_state.wallet == buyer.key()
    )]
    pub user_state: Account<'info, UserState>,
    #[account(
        mut,
        seeds = [b"share_mint".as_ref(), asset_state.key().as_ref()],
        bump = asset_state.share_mint_bump
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = share_mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program
    )]
    pub buyer_shares: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReserveTopUp<'info> {
    #[account(
        mut,
        seeds = [b"asset".as_ref(), &asset_state.asset_id.to_le_bytes()],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct SetWhitelistStatus<'info> {
    #[account(
        mut,
        seeds = [b"asset".as_ref(), &asset_state.asset_id.to_le_bytes()],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + UserState::LEN,
        seeds = [b"user".as_ref(), asset_state.key().as_ref(), wallet.as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimYield<'info> {
    #[account(
        mut,
        seeds = [b"asset".as_ref(), &asset_state.asset_id.to_le_bytes()],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        mut,
        seeds = [b"user".as_ref(), asset_state.key().as_ref(), user.key().as_ref()],
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
        seeds = [b"asset".as_ref(), &asset_state.asset_id.to_le_bytes()],
        bump = asset_state.bump
    )]
    pub asset_state: Account<'info, AssetState>,
    #[account(
        mut,
        seeds = [b"user".as_ref(), asset_state.key().as_ref(), user.key().as_ref()],
        bump = user_state.bump,
        constraint = user_state.wallet == user.key()
    )]
    pub user_state: Account<'info, UserState>,
    #[account(
        mut,
        seeds = [b"share_mint".as_ref(), asset_state.key().as_ref()],
        bump = asset_state.share_mint_bump
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = share_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_shares: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[account]
pub struct MarketplaceState {
    pub admin: Pubkey,
    pub next_asset_id: u64,
    pub bump: u8,
}

#[account]
pub struct AssetState {
    pub asset_id: u64,
    pub total_shares: u64,
    pub sold_shares: u64,
    pub yield_rate: u64,
    pub reserve_pool: u64,
    pub document_hash: [u8; 32],
    pub asset_name: String,
    pub asset_uri: String,
    pub admin: Pubkey,
    pub share_mint: Pubkey,
    pub bump: u8,
    pub share_mint_bump: u8,
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
    #[msg("Invalid share mint")]
    InvalidShareMint,
    #[msg("Invalid token program")]
    InvalidTokenProgram,
    #[msg("Invalid transfer hook program")]
    InvalidTransferHookProgram,
    #[msg("Share mint is already initialized")]
    ShareMintAlreadyInitialized,
    #[msg("Invalid user state")]
    InvalidUserState,
    #[msg("Invalid metadata symbol")]
    InvalidMetadataSymbol,
}

impl MarketplaceState {
    pub const LEN: usize = 32
        + 8
        + 1;
}

impl AssetState {
    pub const MAX_NAME_LEN: usize = 128;
    pub const MAX_URI_LEN: usize = 256;
    pub const LEN: usize = 8
        + 8
        + 8
        + 8
        + 8
        + 32
        + 4 + Self::MAX_NAME_LEN
        + 4 + Self::MAX_URI_LEN
        + 32
        + 32
        + 1
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

fn bytes_to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);

    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }

    out
}
