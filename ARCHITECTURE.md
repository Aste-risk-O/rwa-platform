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
4. `add_to_whitelist`
5. `set_whitelist_status`
6. `buy_shares`
7. `claim_yield`
8. `instant_sell`

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
- stores mint pubkey in `AssetState`

`add_to_whitelist`
- creates per-user per-asset investor state

`set_whitelist_status`
- admin-only helper for explicit allow/deny state
- can initialize a `UserState` PDA with `is_whitelisted = false`
- useful for compliance-driven negative tests and future admin tooling

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
- transfer-hook metadata account creation
- whitelist creation
- explicit blocked-wallet state via `set_whitelist_status`
- token minting on purchase
- yield accrual and payout
- token burn on sell
- direct transfer rejection for non-whitelisted recipient
- direct secondary transfer rejection for whitelisted recipient
- second asset creation in the same marketplace

Latest local status:
- `anchor test` -> `13 passing`

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
- entitlement-sync for true peer-to-peer secondary trading

## Next Technical Steps

- add token metadata flow for asset share mint
- add explicit admin reserve top-up instruction
- add negative tests for buy/sell/claim failure branches
- deploy to devnet
- optionally switch yield/payout demo from lamports to devnet USDC
- decide whether to keep transfers blocked or move to full secondary-market accounting
- build frontend marketplace and wallet flow

## Legal Direction

- token represents revenue-share exposure, not direct title transfer
- SPV/AIFC structure is expected to sit above the on-chain layer
- KYC/AML enforcement remains off-chain or hybrid for the MVP
