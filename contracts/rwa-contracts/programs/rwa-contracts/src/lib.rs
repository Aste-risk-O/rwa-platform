use anchor_lang::prelude::*;

declare_id!("AH6kQ9Uz3Pzizt7hLwjpKhTFRCK5yS3pMjHSVAAaGasB");

#[program]
pub mod rwa_contracts {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
