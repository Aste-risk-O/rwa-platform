# Task List

## DONE
- [x] WSL2 + Solana + Anchor 0.32.1 setup
- [x] anchor init rwa-contracts
- [x] initialize_marketplace instruction
- [x] AssetState and UserState PDA structs
- [x] initialize_asset instruction
- [x] initialize_share_mint instruction
- [x] add_to_whitelist instruction
- [x] buy_shares instruction with whitelist check and token mint
- [x] claim_yield instruction with time-based formula
- [x] instant_sell instruction with 10% discount and token burn
- [x] Token-2022 share mint per asset
- [x] Multi-asset marketplace PDA model
- [x] Store token mint pubkey in AssetState
- [x] Transfer-hook program for Token-2022 share mints
- [x] Configure extra-account-meta PDA for transfer-hook validation
- [x] Token-2022 direct transfer restriction via transfer hook
- [x] Admin `set_whitelist_status` instruction
- [x] anchor build SUCCESS
- [x] Write JS/Anchor tests for marketplace + tokenization flow
- [x] anchor test - 13 tests passing

## NOW -> Demo Hardening
- [ ] Add token metadata flow for each asset share mint
- [ ] Add admin reserve top-up instruction
- [ ] Add tests for reserve top-up
- [x] Decide whitelist enforcement model
- [x] Option B: Token-2022 transfer hook / transfer restriction
- [ ] Add negative tests for main marketplace paths
- [x] non-whitelisted direct token transfer should fail
- [x] direct secondary transfer should fail even for whitelisted recipient
- [ ] non-whitelisted buy should fail
- [ ] sell without tokens should fail
- [ ] claim with empty reserve should fail

## NEXT -> Marketplace + Yield
- [ ] Decide payout asset for demo
- [ ] Option A: keep lamports MVP
- [ ] Option B: switch to devnet USDC token
- [ ] Prepare 1 real demo asset card for coffee shop in Astana
- [ ] Verify document hash flow end-to-end
- [ ] Deploy programs to devnet
- [ ] Create at least one seeded demo asset on devnet

## AFTER -> Frontend
- [ ] npx create-next-app in app/ folder
- [ ] Phantom wallet connect button
- [ ] Property card component (photo, APY 13.2%, price)
- [ ] Buy shares button -> calls buy_shares on-chain
- [ ] Claim button -> calls claim_yield
- [ ] Instant sell button -> calls instant_sell
- [ ] Investor dashboard: balance, accrued yield

## HACKATHON DEMO
- [ ] Public explorer link
- [ ] Solana Blink for Telegram (optional)
- [ ] Record video demo as fallback
- [ ] Pitch deck 5-7 slides
- [ ] Rehearse full demo flow x3
