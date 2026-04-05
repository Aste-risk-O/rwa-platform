# RWA Platform - Architecture

## Concept

Fractional investment into real-world revenue-generating assets on Solana.

Current demo model:
- marketplace can host multiple assets
- each asset has its own `Token-2022` share mint
- investors are whitelisted per asset
- investors buy tokenized shares, accrue yield, and can instant sell back

Initial demo asset:
- Astana coffee shop

## Current Stack

- Anchor CLI `0.32.1`
- `anchor-lang = 0.32.1`
- `anchor-spl = 0.32.1`
- Solana/Agave toolchain `2.3.0`
- JS `@coral-xyz/anchor ^0.32.1`
- JS `@solana/spl-token ^0.4.14`
- frontend still planned, not implemented in this repo

## Current On-Chain Model

Implemented instructions:
1. `initialize_marketplace`
2. `initialize_asset`
3. `initialize_share_mint`
4. `add_to_whitelist`
5. `buy_shares`
6. `claim_yield`
7. `instant_sell`

Economic model today:
- share price is fixed at `1 SOL`
- payments and payouts use native SOL in lamports
- share ownership is represented by `Token-2022` tokens with `0` decimals
- instant sell returns `90%` of the fixed share price

## PDA Accounts

`MarketplaceState`
- seeds: `["marketplace"]`
- fields: `admin`, `next_asset_id`, `bump`

`AssetState`
- seeds: `["asset", asset_id_le_bytes]`
- fields:
  - `asset_id`
  - `total_shares`
  - `sold_shares`
  - `yield_rate`
  - `reserve_pool`
  - `document_hash`
  - `asset_name`
  - `asset_uri`
  - `admin`
  - `share_mint`
  - `bump`
  - `share_mint_bump`

`UserState`
- seeds: `["user", asset_state, wallet]`
- fields: `wallet`, `shares_owned`, `last_claim_timestamp`, `is_whitelisted`, `bump`

`ShareMint`
- seeds: `["share_mint", asset_state]`
- token standard: `Token-2022`
- decimals: `0`
- mint authority: `asset_state` PDA

## Instruction Behavior

`initialize_marketplace`
- creates the top-level marketplace state

`initialize_asset`
- creates a new asset PDA
- stores asset metadata and proof-of-asset hash
- increments `next_asset_id`

`initialize_share_mint`
- creates one `Token-2022` mint for the asset
- stores mint pubkey in `AssetState`

`add_to_whitelist`
- creates per-user per-asset investor state

`buy_shares`
- checks whitelist status
- transfers SOL from investor to asset reserve
- mints share tokens to investor ATA
- updates `shares_owned`, `sold_shares`, and `reserve_pool`

`claim_yield`
- calculates accrued yield as:
- `(elapsed_seconds * shares_owned * yield_rate) / 86400`
- pays from asset reserve to the user wallet

`instant_sell`
- burns investor share tokens
- decreases owned and sold shares
- pays `90%` of fixed share price from reserve pool

## Test Coverage

Current Anchor tests cover:
- marketplace initialization
- asset creation
- share mint creation
- whitelist creation
- token minting on purchase
- yield accrual and payout
- token burn on sell
- second asset creation in the same marketplace

Latest local status:
- `anchor test` -> `8 passing`

## Asset Binding

- off-chain legal or commercial document is hashed with SHA-256
- hash is stored in `AssetState.document_hash`
- asset URI can point to off-chain JSON metadata
- verifier flow:
  - download source document
  - compute hash
  - compare to on-chain value

## What Is Not On-Chain

- KYC payloads
- raw PDF/legal files
- fiat rent payment confirmations
- marketplace frontend
- secondary market order book

## Next Technical Steps

- add token metadata flow for asset share mint
- add explicit admin reserve top-up instruction
- deploy to devnet
- optionally switch yield/payout demo from lamports to devnet USDC
- build frontend marketplace and wallet flow

## Legal Direction

- token represents revenue-share exposure, not direct title transfer
- SPV/AIFC structure is expected to sit above the on-chain layer
- KYC/AML enforcement remains off-chain or hybrid for the MVP
