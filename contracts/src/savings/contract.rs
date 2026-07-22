use soroban_sdk::{contract, contractimpl, token, Address, Env};

use crate::core::errors::ContractError;
use crate::savings::events;
use crate::savings::storage;
use crate::savings::types::DataKey;

#[contract]
pub struct SavingsContract;

#[contractimpl]
impl SavingsContract {
    /// Initializes the contract with the USDC token contract address.
    ///
    /// Runs atomically at deploy time. The deployer's transaction signature
    /// is the trust root — no front-running window exists.
    pub fn __constructor(env: Env, token_address: Address) {
        env.storage()
            .instance()
            .set(&DataKey::TokenAddress, &token_address);
    }

    pub fn deposit_savings(env: Env, user: Address, amount: i128) -> Result<(), ContractError> {
        user.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let token_address = storage::get_token_address(&env);
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        let mut record = storage::get_user_savings(&env, &user);
        record.principal = record
            .principal
            .checked_add(amount)
            .ok_or(ContractError::Overflow)?;
        storage::set_user_savings(&env, &user, &record);

        events::emit_savings_deposited(&env, &user, amount);

        Ok(())
    }

    /// Claims only the accumulated yield for `user` without touching principal.
    ///
    /// Execution order (checks-effects-interactions):
    /// 1. Authorize the claiming user.
    /// 2. Load the user's savings record.
    /// 3. Reject if `yield_shares <= 0`.
    /// 4. Snapshot the yield amount.
    /// 5. Zero yield_shares and persist BEFORE external call.
    /// 6. Transfer the exact snapshot from contract to user.
    /// 7. Emit the event.
    pub fn claim_yield(env: Env, user: Address) -> Result<(), ContractError> {
        user.require_auth();

        let mut record = storage::get_user_savings(&env, &user);

        if record.yield_shares <= 0 {
            return Err(ContractError::NoYieldToClaim);
        }

        let yield_to_transfer = record.yield_shares;
        record.yield_shares = 0;
        storage::set_user_savings(&env, &user, &record);

        let token_address = storage::get_token_address(&env);
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &user, &yield_to_transfer);

        events::emit_savings_yield_claimed(&env, &user, yield_to_transfer);

        Ok(())
    }
}
