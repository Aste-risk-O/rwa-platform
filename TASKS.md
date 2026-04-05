# Task List

## DONE
- [x] WSL2 + Solana + Anchor 0.32.1 setup
- [x] anchor init rwa-contracts
- [x] AssetState and UserState PDA structs
- [x] initialize_asset instruction
- [x] add_to_whitelist instruction
- [x] buy_shares instruction with whitelist check
- [x] claim_yield instruction with time-based formula
- [x] instant_sell instruction with 10% discount
- [x] anchor build SUCCESS
- [x] Write JS tests for all 5 instructions
- [x] anchor test — all pass

## NOW — Real Tokenization
- [ ] Create Token-2022 share mint
- [ ] Add mint authority / admin flow for share token
- [ ] Create investor token account flow
- [ ] buy_shares -> mint or transfer share tokens to buyer
- [ ] instant_sell -> return / burn share tokens before payout
- [ ] Store token mint pubkey in AssetState
- [ ] Add metadata flow for asset token (name, symbol, uri)
- [ ] Decide whitelist enforcement model:
- [ ] Option A: program-level checks only
- [ ] Option B: Token-2022 Transfer Hook / transfer restriction

## NEXT — Marketplace + Yield
- [ ] Decide payout asset for demo:
- [ ] Option A: lamports MVP
- [ ] Option B: devnet USDC token
- [ ] Add reserve funding flow for payouts
- [ ] Add admin top-up instruction for reserve pool
- [ ] Prepare 1 real demo asset card for coffee shop in Astana
- [ ] Verify document hash flow end-to-end

## AFTER — Frontend
- [ ] npx create-next-app in app/ folder
- [ ] Phantom wallet connect button
- [ ] Property card component (photo, APY 13.2%, price)
- [ ] Buy shares button -> calls buy_shares on-chain
- [ ] Claim button -> calls claim_yield
- [ ] Instant sell button -> calls instant_sell
- [ ] Investor dashboard: balance, accrued yield

## HACKATHON DEMO
- [ ] anchor deploy to devnet
- [ ] Public explorer link
- [ ] Solana Blink for Telegram (optional)
- [ ] Record video demo as fallback
- [ ] Pitch deck 5-7 slides
- [ ] Rehearse full demo flow x3
