# RWA Platform

Solana/Anchor MVP for a tokenized real-world asset marketplace.

Current status:
- multi-asset marketplace on Solana
- per-asset `Token-2022` share mint
- whitelist-based investing flow
- `Token-2022` transfer-hook enforcement for direct transfers
- in-mint `Token-2022` metadata with `MetadataPointer`
- admin reserve top-up flow
- devnet seed and verification scripts for a demo asset package
- buy, yield claim, and instant sell logic
- full Anchor test suite passing locally

Project focus:
- demo marketplace for tokenized revenue-share assets
- first demo asset: Astana coffee shop
- payments and yield are currently in native SOL lamports
- share ownership is represented by `Token-2022` tokens

## Repo Layout

- `contracts/rwa-contracts` - Anchor programs, IDLs, tests, JS deps
- `ARCHITECTURE.md` - current system design and on-chain model
- `TASKS.md` - implementation status and next steps
- `RULES.md` - project constraints and product intent
- `contracts/rwa-contracts/devnet` - demo asset package, metadata JSON, and doc bundle manifest

## Implemented On-Chain Flow

Marketplace program:
1. `initialize_marketplace` creates marketplace state with admin and `next_asset_id`
2. `initialize_asset` creates a new asset PDA for the marketplace
3. `initialize_share_mint` creates a `Token-2022` mint for that asset
4. `initialize_share_metadata` writes canonical metadata into the mint itself
5. `add_to_whitelist` creates investor state for a wallet and asset
6. `set_whitelist_status` lets admin explicitly allow or block a wallet
7. `reserve_top_up` lets admin inject reserve liquidity into an asset
8. `buy_shares` transfers SOL to the asset reserve and mints share tokens
9. `claim_yield` pays accrued yield from the reserve pool
10. `instant_sell` burns share tokens and pays back 90% of share price

Transfer-hook program:
1. `configure_asset_hook` creates the validation PDA for a share mint
2. `execute` enforces token-level transfer restrictions on every direct transfer

Current token-level compliance behavior:
- non-whitelisted recipients are rejected on direct transfer
- direct secondary transfers are currently blocked even for whitelisted users
- this keeps token balances from drifting away from marketplace entitlement accounting

## Test Status

The Anchor test suite currently covers:
- marketplace initialization
- asset creation
- share mint creation
- canonical in-mint metadata initialization
- transfer-hook metadata setup
- whitelist flow
- explicit blocked-wallet state
- reserve top-up
- token mint on buy
- yield accrual and payout
- token burn on instant sell
- negative tests for buy/sell/claim failure branches
- transfer rejection for non-whitelisted recipient
- transfer rejection for direct secondary movement
- creation of a second marketplace asset

Latest local result:
- `18 passing`

## Local Run

From `contracts/rwa-contracts`:

```bash
yarn install
anchor build
anchor test
```

## Devnet Demo Prep

The repo now includes a reproducible devnet asset package for the first demo asset:

- asset config: `contracts/rwa-contracts/devnet/astana-coffee-shop.asset.json`
- off-chain metadata file: `contracts/rwa-contracts/devnet/astana-coffee-shop.metadata.json`
- canonical document bundle manifest: `contracts/rwa-contracts/devnet/documents/astana-coffee-shop.bundle-manifest.json`

From `contracts/rwa-contracts`:

```bash
yarn seed:devnet
yarn verify:devnet
```

The verification step compares the local document bundle SHA-256 against:

- on-chain `AssetState.document_hash`
- in-mint `Token-2022` metadata field `document_hash`

If local validator starts slowly on WSL, `Anchor.toml` already includes:

```toml
[test]
startup_wait = 20000
```

## What Is Still Missing

- devnet deployment and first live seed run
- optional switch from lamports to devnet USDC for demo payouts
- frontend marketplace UI
