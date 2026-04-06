# RWA Platform - Architecture

## Concept

Fractional investment into real-world revenue-generating assets on Solana.

Current demo model:
- marketplace can host multiple assets
- each asset has its own `Token-2022` share mint
- investors are whitelisted per asset
- investors buy tokenized shares, accrue yield, and can instant sell back
- each share mint is wired to a dedicated transfer-hook program
- direct peer-to-peer token transfers are compliance-gated on-chain

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

Implemented marketplace instructions:
1. `initialize_marketplace`
2. `initialize_asset`
3. `initialize_share_mint`
4. `initialize_share_metadata`
5. `add_to_whitelist`
6. `set_whitelist_status`
7. `reserve_top_up`
8. `buy_shares`
9. `claim_yield`
10. `instant_sell`

Implemented hook-program instructions:
1. `configure_asset_hook`
2. `execute` (`Token-2022` transfer-hook entrypoint)

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
- transfer hook program: `rwa-transfer-hook`
- metadata pointer: points to the mint itself
- canonical metadata: stored directly in the mint TLV data

`ExtraAccountMetaList`
- seeds: `["extra-account-metas", share_mint]`
- owner: `rwa-transfer-hook`
- purpose: gives Token-2022 the extra accounts needed to resolve:
  - `asset_state`
  - `rwa_contracts` program id
  - destination `UserState` PDA

## Instruction Behavior

`initialize_marketplace`
- creates the top-level marketplace state

`initialize_asset`
- creates a new asset PDA
- stores asset metadata and proof-of-asset hash
- increments `next_asset_id`

`initialize_share_mint`
- creates one `Token-2022` mint for the asset
- initializes the mint with the `TransferHook` extension
- initializes the mint with the `MetadataPointer` extension
- stores mint pubkey in `AssetState`

`initialize_share_metadata`
- writes canonical `Token-2022` metadata directly into the mint
- uses the asset PDA as mint authority for initialization
- stores:
  - `name = "{asset_name} Shares"`
  - `symbol`
  - `uri = asset_uri`
  - `asset_id` in additional metadata
  - `document_hash` in additional metadata

`add_to_whitelist`
- creates per-user per-asset investor state

`set_whitelist_status`
- admin-only helper for explicit allow/deny state
- can initialize a `UserState` PDA with `is_whitelisted = false`
- useful for compliance-driven negative tests and future admin tooling

`reserve_top_up`
- admin-only reserve injection
- transfers SOL from admin wallet to the asset PDA
- increases `reserve_pool` without changing token supply

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

`configure_asset_hook`
- creates the transfer-hook validation PDA for a specific share mint
- stores the extra account metas needed to derive destination `UserState`

`execute`
- runs on every direct `Token-2022` transfer for the share mint
- verifies destination wallet has a matching per-asset `UserState`
- requires destination `UserState.is_whitelisted = true`
- currently disables secondary peer-to-peer transfers even between whitelisted users
- this prevents token balances from diverging from entitlement accounting while
  `shares_owned` still lives in the marketplace program

## Test Coverage

Current Anchor tests cover:
- marketplace initialization
- asset creation
- share mint creation
- in-mint metadata initialization
- transfer-hook metadata account creation
- whitelist creation
- explicit blocked-wallet state via `set_whitelist_status`
- reserve top-up accounting
- token minting on purchase
- yield accrual and payout
- token burn on sell
- negative tests for non-whitelisted buy, zero-share sell, and insufficient reserve claim
- direct transfer rejection for non-whitelisted recipient
- direct secondary transfer rejection for whitelisted recipient
- second asset creation in the same marketplace

Latest local status:
- `anchor test` -> `18 passing`

## Asset Binding

- off-chain legal or commercial document is hashed with SHA-256
- hash is stored in `AssetState.document_hash`
- asset URI can point to off-chain JSON metadata
- canonical token metadata is also stored inside the mint via `Token-2022`
- the mint metadata includes `asset_id` and `document_hash` for cross-checking
- the repo now includes a demo asset package under `contracts/rwa-contracts/devnet`
- verifier flow:
  - download source document
  - compute hash
  - compare to on-chain `document_hash`
  - verify the mint metadata points to the same asset package and asset id

## Devnet Demo Package

The repo includes one reproducible demo asset package:

- `astana-coffee-shop.asset.json` - seeding config
- `astana-coffee-shop.metadata.json` - off-chain metadata file to host publicly later
- `documents/astana-coffee-shop.bundle-manifest.json` - canonical placeholder document bundle

Supporting JS scripts:

- `yarn seed:devnet` - initializes marketplace, asset, share mint, in-mint metadata, hook config, whitelist entries, and reserve target
- `yarn verify:devnet` - checks local bundle hash against on-chain `document_hash` and mint metadata fields

## What Is Not On-Chain

- KYC payloads
- raw PDF/legal files
- fiat rent payment confirmations
- marketplace frontend
- secondary market order book
- entitlement-sync for true peer-to-peer secondary trading

## Next Technical Steps

- deploy to devnet
- run the first live demo asset seed on devnet
- optionally switch yield/payout demo from lamports to devnet USDC
- decide whether to keep transfers blocked or move to full secondary-market accounting
- build frontend marketplace and wallet flow

## Legal Direction

- token represents revenue-share exposure, not direct title transfer
- SPV/AIFC structure is expected to sit above the on-chain layer
- KYC/AML enforcement remains off-chain or hybrid for the MVP
