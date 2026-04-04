# Coding Rules for AI

## Solana / Anchor
- Always use Anchor 0.30+ syntax
- Always use Token-2022 (not legacy SPL Token)
- Always store user data in PDA accounts, never inside the program
- Never write Ethereum-style code (no mappings, no msg.sender)
- Use ctx.accounts pattern for all account validation
- Add #[error_code] for every custom error

## General
- Never hardcode private keys or wallet addresses
- All secrets go in .env file
- Split every task into the smallest possible step
- Write one instruction per Anchor function
