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

## TODAY — Tests + Frontend start
- [ ] Write JS tests for all 5 instructions (tests/rwa-contracts.ts)
- [ ] anchor test — all pass
- [ ] npx create-next-app in app/ folder
- [ ] Phantom wallet connect button
- [ ] Property card component (photo, APY 13.2%, price)

## DAY 3 — Full UI flow
- [ ] Buy shares button → calls buy_shares on-chain
- [ ] Streaming yield counter (JS interpolation, no transactions)
- [ ] Claim button → calls claim_yield
- [ ] Instant sell button → calls instant_sell
- [ ] Investor dashboard: balance, accrued yield

## DAY 4 — Demo + Pitch
- [ ] Solana Blink for Telegram (Actions API)
- [ ] Proof-of-asset verify button (hash check in browser)
- [ ] anchor deploy to devnet, public explorer link
- [ ] Record video demo as fallback (Loom, 2-3 min)
- [ ] Pitch deck 5-7 slides (Gamma.app)
- [ ] Rehearse full demo flow x3
