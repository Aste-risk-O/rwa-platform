# RWA Platform — Architecture

## Concept
Fractional investment into Astana street-retail real estate.
MVP: 1 real asset (coffee shop, real address), investors buy share tokens,
receive yield in lamports (USDC in v2), can sell back at 10% discount.

## Current Stack
- Anchor CLI: 0.32.1
- anchor-lang: 0.32.1
- Solana/Agave toolchain: 2.3.0
- JS: @coral-xyz/anchor ^0.32.1
- Frontend: Next.js 14, Tailwind CSS (planned)
- Wallet: Phantom via @solana/wallet-adapter (planned)

## On-chain (DEPLOYED, lamports MVP)
1. initialize_asset — creates AssetState PDA, sets admin
2. add_to_whitelist — admin adds wallet to UserState PDA
3. buy_shares — whitelist check, transfers lamports, updates shares
4. claim_yield — (now - last_claim) * shares * rate / 86400
5. instant_sell — returns shares, pays 90% of SHARE_PRICE back

## PDA Accounts
AssetState (seeds: ["asset"]):
  total_shares, sold_shares, yield_rate, reserve_pool,
  document_hash: [u8;32], asset_name, asset_uri, admin, bump

UserState (seeds: ["user", wallet]):
  wallet, shares_owned, last_claim_timestamp, is_whitelisted, bump

## Asset Binding (Proof-of-Asset)
- Real PDF lease agreement for coffee shop in Astana
- SHA-256 hash stored in AssetState.document_hash
- Token metadata URI points to JSON: name, address, area, rent, photo, hash
- Anyone can verify: download PDF → compute hash → compare on-chain

## Planned (v2, post-MVP)
- Token-2022 with Transfer Hook for KYC whitelist enforcement at L1
- USDC real payments via SPV → Binance KZ → reward pool
- Solana Blinks for Telegram purchases
- SumSub KYC → add_to_whitelist automation
- P2P order book when reserve pool empty

## What is NOT on-chain (intentional)
- KYC data (off-chain, SumSub or mock)
- PDF document itself (too large)
- Rent payment confirmations (SPV bank account)

## Legal Structure
- SPV in AIFC (МФЦА) jurisdiction, English law
- FinTech Lab sandbox application in progress
- Token = revenue share right, not property ownership
- Umbrella SPV model, trust management agreement
