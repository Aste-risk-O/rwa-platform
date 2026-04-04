
# RWA Platform — Architecture

## What it does

Fractional investment into Astana street-retail real estate.

MVP: investors buy share tokens,

receive USDC yield, can sell back at 15% discount.

## Stack

- Contract: Anchor 0.30+, Token-2022, Solana devnet

- Frontend: Next.js 14, Tailwind CSS

- Wallet: Phantom via @solana/wallet-adapter

- API: Next.js API routes only

## On-chain logic

1. mint_shares — owner mints fixed supply of share tokens

2. buy_shares — user pays USDC, receives share tokens, checks whitelist

3. add_to_whitelist — admin adds verified wallet to PDA

4. claim_yield — calculates (now - last_claim) * rate, sends USDC

5. instant_sell — user returns tokens, gets USDC minus 15% discount

## Accounts (PDA)

- AssetState: total_shares, sold_shares, yield_rate, reserve_pool

- UserState: wallet, shares_owned, last_claim_timestamp, is_whitelisted


## Asset Binding Mechanism

### How a real asset connects to the token
1. PDF lease agreement exists (real document, real Astana address)
2. SHA-256 hash of PDF is computed off-chain
3. Hash is stored in AssetState PDA field: document_hash: [u8; 32]
4. Token metadata URI points to JSON with: name, address, area, rent, photo, hash
5. Anyone can verify: download PDF → compute hash → compare with on-chain hash

### Extra fields in AssetState
- document_hash: [u8; 32]  — SHA-256 of lease agreement PDF
- asset_name: String        — e.g. "Surf Coffee, Baykonurova 12, Astana"
- asset_uri: String         — link to metadata JSON (IPFS or Vercel)

### What is NOT on-chain (intentionally)
- The PDF itself (too large)
- Rent payment confirmations (off-chain, SPV bank account)
- KYC data (off-chain, mock for hackathon)

### Trust flow for jury
PDF exists → hash matches on-chain → token is legitimate
