# RWA Platform

Solana/Anchor MVP for a tokenized real-world asset marketplace.

Current status:
- multi-asset marketplace on Solana
- per-asset `Token-2022` share mint
- whitelist-based investing flow
- buy, yield claim, and instant sell logic
- full Anchor test suite passing locally

Project focus:
- demo marketplace for tokenized revenue-share assets
- first demo asset: Astana coffee shop
- payments/yield are currently in native SOL lamports
- share ownership is represented by `Token-2022` tokens

## Repo Layout

- `contracts/rwa-contracts` - Anchor program, IDL, tests, JS deps
- `ARCHITECTURE.md` - current system design and on-chain model
- `TASKS.md` - implementation status and next steps
- `RULES.md` - project constraints and product intent

## Implemented On-Chain Flow

1. `initialize_marketplace` creates marketplace state with admin and `next_asset_id`
2. `initialize_asset` creates a new asset PDA for the marketplace
3. `initialize_share_mint` creates a `Token-2022` mint for that asset
4. `add_to_whitelist` creates investor state for a wallet and asset
5. `buy_shares` transfers SOL to the asset reserve and mints share tokens
6. `claim_yield` pays accrued yield from the reserve pool
7. `instant_sell` burns share tokens and pays back 90% of share price

## Test Status

The Anchor test suite currently covers:
- marketplace initialization
- asset creation
- share mint creation
- whitelist flow
- token mint on buy
- yield accrual and payout
- token burn on instant sell
- creation of a second marketplace asset

Latest local result:
- `8 passing`

## Local Run

From `contracts/rwa-contracts`:

```bash
yarn install
anchor build
anchor test
```

If local validator starts slowly on WSL, `Anchor.toml` already includes:

```toml
[test]
startup_wait = 20000
```

## What Is Still Missing

- token metadata for marketplace display
- reserve top-up instruction for admin
- devnet deployment
- frontend marketplace UI
- optional switch from lamports to devnet USDC for demo payouts
