# Devnet Demo Flow

This folder packages one reproducible demo asset for devnet seeding and later frontend work.

## Files

- `astana-coffee-shop.asset.json` - seeding config used by the JS script
- `astana-coffee-shop.metadata.json` - off-chain asset metadata JSON to host later
- `documents/astana-coffee-shop.bundle-manifest.json` - canonical placeholder document bundle manifest

## What This Gives Us

- one concrete asset package for demo seeding
- one canonical document bundle whose SHA-256 becomes the on-chain `document_hash`
- one off-chain metadata file that should be hosted and referenced by `asset_uri`

## Current Demo Choice

- payout asset for demo: native SOL in lamports
- share token standard: `Token-2022`
- compliance model: transfer hook + whitelist

This keeps the demo realistic without adding a second token dependency before frontend work.

## Before Seeding

From `contracts/rwa-contracts`:

```bash
yarn install
anchor build
```

Deploy both programs to devnet with your own upgrade authority wallet:

```bash
solana config set --url devnet
solana airdrop 2
anchor deploy --provider.cluster devnet
```

If program ids change during deployment, run:

```bash
anchor keys sync
anchor build
anchor deploy --provider.cluster devnet
```

## Seed The Demo Asset

From `contracts/rwa-contracts`:

```bash
$env:ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
$env:ANCHOR_WALLET="$HOME/.config/solana/id.json"
yarn seed:devnet
```

Optional custom asset config:

```bash
$env:RWA_ASSET_CONFIG="C:\Users\User\rwa-platform\contracts\rwa-contracts\devnet\astana-coffee-shop.asset.json"
yarn seed:devnet
```

The seed script is idempotent for:

- marketplace creation
- asset creation
- share mint creation
- mint metadata initialization
- transfer-hook configuration
- whitelist setup
- reserve top-up target

## Verify Document Binding

After seeding:

```bash
$env:ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
$env:ANCHOR_WALLET="$HOME/.config/solana/id.json"
yarn verify:devnet
```

This checks:

- `AssetState.document_hash` matches the local bundle manifest SHA-256
- `AssetState.asset_uri` matches the configured metadata URI
- in-mint `Token-2022` metadata stores the same `asset_id`
- in-mint `Token-2022` metadata stores the same `document_hash`

## For A Public Demo

Before showing this outside a developer environment:

1. Host `astana-coffee-shop.metadata.json` somewhere public.
2. Replace `assetUri` in `astana-coffee-shop.asset.json` with that hosted URL.
3. Re-seed or create a fresh asset so on-chain metadata points to the public file.
4. Replace the placeholder bundle manifest with a real signed document package.
