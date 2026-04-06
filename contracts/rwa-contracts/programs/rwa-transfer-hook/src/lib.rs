use anchor_lang::{
    prelude::*,
    solana_program::{
        program::invoke_signed,
        system_instruction,
    },
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;
use std::convert::TryInto;

declare_id!("46Qyj9daA4R3gRuEJzVCDuJX43An4oz4PsdzUXjV3sG8");

const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";
const DESTINATION_ACCOUNT_INDEX: u8 = 2;
const DESTINATION_TOKEN_OWNER_OFFSET: u8 = 32;
const DESTINATION_TOKEN_OWNER_LEN: u8 = 32;
const ASSET_STATE_EXECUTE_INDEX: u8 = 5;
const RWA_PROGRAM_EXECUTE_INDEX: u8 = 6;

pub const RWA_CONTRACTS_ID: Pubkey = pubkey!("AH6kQ9Uz3Pzizt7hLwjpKhTFRCK5yS3pMjHSVAAaGasB");

#[program]
pub mod rwa_transfer_hook {
    use super::*;

    pub fn configure_asset_hook(ctx: Context<ConfigureAssetHook>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.rwa_contracts_program.key(),
            RWA_CONTRACTS_ID,
            TransferHookError::InvalidRwaContractsProgram
        );

        let asset_state = read_asset_state(&ctx.accounts.asset_state)?;

        require_keys_eq!(
            ctx.accounts.admin.key(),
            asset_state.admin,
            TransferHookError::AdminOnly
        );
        require_keys_eq!(
            ctx.accounts.share_mint.key(),
            asset_state.share_mint,
            TransferHookError::InvalidShareMint
        );
        require!(
            ctx.accounts.extra_account_meta_list.lamports() == 0,
            TransferHookError::ExtraAccountMetaListAlreadyInitialized
        );

        let extra_metas = [
            ExtraAccountMeta::new_with_pubkey(&ctx.accounts.asset_state.key(), false, false)?,
            ExtraAccountMeta::new_with_pubkey(
                &ctx.accounts.rwa_contracts_program.key(),
                false,
                false,
            )?,
            ExtraAccountMeta::new_external_pda_with_seeds(
                RWA_PROGRAM_EXECUTE_INDEX,
                &[
                    Seed::Literal {
                        bytes: b"user".to_vec(),
                    },
                    Seed::AccountKey {
                        index: ASSET_STATE_EXECUTE_INDEX,
                    },
                    Seed::AccountData {
                        account_index: DESTINATION_ACCOUNT_INDEX,
                        data_index: DESTINATION_TOKEN_OWNER_OFFSET,
                        length: DESTINATION_TOKEN_OWNER_LEN,
                    },
                ],
                false,
                false,
            )?,
        ];
        let account_size = ExtraAccountMetaList::size_of(extra_metas.len())?;

        let rent_lamports = Rent::get()?.minimum_balance(account_size);
        let share_mint_key = ctx.accounts.share_mint.key();
        let signer_seeds: &[&[u8]] = &[
            EXTRA_ACCOUNT_METAS_SEED,
            share_mint_key.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ];

        invoke_signed(
            &system_instruction::create_account(
                &ctx.accounts.admin.key(),
                &ctx.accounts.extra_account_meta_list.key(),
                rent_lamports,
                account_size as u64,
                &crate::ID,
            ),
            &[
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.extra_account_meta_list.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_metas)?;

        Ok(())
    }

    #[interface(spl_transfer_hook_interface::execute)]
    pub fn execute(ctx: Context<ExecuteTransferHook>, _amount: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.rwa_contracts_program.key(),
            RWA_CONTRACTS_ID,
            TransferHookError::InvalidRwaContractsProgram
        );

        let asset_state = read_asset_state(&ctx.accounts.asset_state)?;
        require_keys_eq!(
            ctx.accounts.mint.key(),
            asset_state.share_mint,
            TransferHookError::InvalidShareMint
        );

        let destination_token = read_token_account_base(&ctx.accounts.destination_token)?;
        let source_token = read_token_account_base(&ctx.accounts.source_token)?;

        require_keys_eq!(
            destination_token.mint,
            ctx.accounts.mint.key(),
            TransferHookError::InvalidTokenAccount
        );
        require_keys_eq!(
            source_token.mint,
            ctx.accounts.mint.key(),
            TransferHookError::InvalidTokenAccount
        );

        let destination_owner = destination_token.owner;
        let expected_destination_user_state = derive_user_state_address(
            &ctx.accounts.asset_state.key(),
            &destination_owner,
        );

        require_keys_eq!(
            ctx.accounts.destination_user_state.key(),
            expected_destination_user_state,
            TransferHookError::InvalidUserState
        );

        let destination_user_state = read_user_state(&ctx.accounts.destination_user_state)?;
        require_keys_eq!(
            destination_user_state.wallet,
            destination_owner,
            TransferHookError::InvalidUserState
        );
        require!(
            destination_user_state.is_whitelisted,
            TransferHookError::RecipientNotWhitelisted
        );

        let source_owner = source_token.owner;
        require_keys_eq!(
            source_owner,
            destination_owner,
            TransferHookError::SecondaryTransfersDisabled
        );

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ConfigureAssetHook<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: PDA derived and initialized with hook metadata by this program.
    #[account(
        mut,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, share_mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    /// CHECK: The mint is validated against the asset state's stored
    /// `share_mint` field before any hook metadata is written.
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: Deserialized manually because the account belongs to the main marketplace program.
    #[account(owner = RWA_CONTRACTS_ID)]
    pub asset_state: UncheckedAccount<'info>,
    /// CHECK: Fixed program id used for external PDA derivation.
    #[account(address = RWA_CONTRACTS_ID)]
    pub rwa_contracts_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteTransferHook<'info> {
    /// CHECK: Parsed manually as a Token-2022 account because the transfer-hook
    /// interface forwards generic accounts during IDL generation.
    pub source_token: UncheckedAccount<'info>,
    /// CHECK: Validated against the asset state's stored `share_mint` field.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: Parsed manually as a Token-2022 account because the transfer-hook
    /// interface forwards generic accounts during IDL generation.
    pub destination_token: UncheckedAccount<'info>,
    /// CHECK: The token owner/delegate forwarded by Token-2022.
    pub owner_delegate: UncheckedAccount<'info>,
    /// CHECK: Validation PDA defined by the transfer-hook interface.
    #[account(
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    /// CHECK: Deserialized manually because the account belongs to the main marketplace program.
    #[account(owner = RWA_CONTRACTS_ID)]
    pub asset_state: UncheckedAccount<'info>,
    /// CHECK: External program id used to derive user-state PDA.
    #[account(address = RWA_CONTRACTS_ID)]
    pub rwa_contracts_program: UncheckedAccount<'info>,
    /// CHECK: Deserialized manually because the account belongs to the main marketplace program.
    #[account(owner = RWA_CONTRACTS_ID)]
    pub destination_user_state: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
struct AssetStateData {
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
struct UserStateData {
    pub wallet: Pubkey,
    pub shares_owned: u64,
    pub last_claim_timestamp: i64,
    pub is_whitelisted: bool,
    pub bump: u8,
}

struct TokenAccountBaseData {
    pub mint: Pubkey,
    pub owner: Pubkey,
}

#[error_code]
pub enum TransferHookError {
    #[msg("Only the marketplace admin can configure this hook")]
    AdminOnly,
    #[msg("The provided share mint does not belong to this asset")]
    InvalidShareMint,
    #[msg("The provided marketplace program id is invalid")]
    InvalidRwaContractsProgram,
    #[msg("The derived user-state PDA is invalid")]
    InvalidUserState,
    #[msg("Recipient wallet is not whitelisted for this asset")]
    RecipientNotWhitelisted,
    #[msg("Direct secondary transfers are disabled until entitlement accounting is upgraded")]
    SecondaryTransfersDisabled,
    #[msg("The transfer-hook config PDA has already been initialized")]
    ExtraAccountMetaListAlreadyInitialized,
    #[msg("Unexpected account data")]
    InvalidAccountData,
    #[msg("Unexpected token account data")]
    InvalidTokenAccount,
}

fn derive_user_state_address(asset_state: &Pubkey, wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"user", asset_state.as_ref(), wallet.as_ref()],
        &RWA_CONTRACTS_ID,
    )
    .0
}

fn read_asset_state(account: &AccountInfo<'_>) -> Result<AssetStateData> {
    read_anchor_account(account)
}

fn read_user_state(account: &AccountInfo<'_>) -> Result<UserStateData> {
    read_anchor_account(account)
}

fn read_token_account_base(account: &AccountInfo<'_>) -> Result<TokenAccountBaseData> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= 64, TransferHookError::InvalidTokenAccount);

    let mint_bytes: [u8; 32] = data[0..32]
        .try_into()
        .map_err(|_| error!(TransferHookError::InvalidTokenAccount))?;
    let owner_bytes: [u8; 32] = data[32..64]
        .try_into()
        .map_err(|_| error!(TransferHookError::InvalidTokenAccount))?;

    Ok(TokenAccountBaseData {
        mint: Pubkey::new_from_array(mint_bytes),
        owner: Pubkey::new_from_array(owner_bytes),
    })
}

fn read_anchor_account<T: AnchorDeserialize>(account: &AccountInfo<'_>) -> Result<T> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= 8, TransferHookError::InvalidAccountData);

    let mut slice: &[u8] = &data[8..];
    T::deserialize(&mut slice).map_err(|_| error!(TransferHookError::InvalidAccountData))
}
