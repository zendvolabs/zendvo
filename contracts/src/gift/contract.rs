use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env};

use crate::{
    core::{errors::ContractError, events::emit_initialized},
    gift::{
        events::emit_gift_created,
        storage::{get_gift_counter, get_token_address, set_gift, set_gift_counter},
        types::{DataKey, Gift},
    },
};

/// Maximum duration a gift's unlock time can be set into the future:
/// 5 years expressed in seconds (5 × 365 × 24 × 60 × 60).
///
/// This hard cap prevents users from accidentally locking funds for
/// unreasonable lengths of time due to front-end timestamp miscalculations
/// (e.g. a bug that passes milliseconds instead of seconds).
pub const MAX_LOCK_DURATION_SECONDS: u64 = 5 * 365 * 24 * 60 * 60; // 157_680_000 s

/// Entry point for the time-locked gift contract.
#[contract]
pub struct GiftContract;

#[contractimpl]
impl GiftContract {
    /// Initializes the contract with a backend admin address and the USDC
    /// token contract address.
    ///
    /// Must be called exactly once immediately after deployment.
    /// Reverts if the admin has already been set, preventing any actor
    /// from overwriting admin rights post-deployment.
    pub fn initialize(
        env: Env,
        admin: Address,
        token_address: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        // Guard: panic if already initialized to prevent admin hijacking.
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TokenAddress, &token_address);

        emit_initialized(&env, &admin);

        Ok(())
    }

    /// Locks USDC from `sender` into the contract as a time-locked gift for
    /// `recipient`, releasing after `unlock_time` (Unix timestamp in seconds).
    ///
    /// The transfer and record creation are atomic: if the token transfer
    /// fails (insufficient balance, missing trustline, etc.) the entire
    /// invocation reverts and no gift record is written.
    ///
    /// # Arguments
    ///
    /// * `sender`      – The address funding the gift; must authorise this call.
    /// * `recipient`   – The address that will claim the gift.
    /// * `amount`      – Token units to lock (must be > 0).
    /// * `unlock_time` – UNIX timestamp (seconds) after which the gift can be
    ///                   claimed. Must not exceed `ledger_now + MAX_LOCK_DURATION_SECONDS`.
    ///
    /// Returns the newly generated `gift_id`.
    pub fn create_gift(
        env: Env,
        sender: Address,
        recipient: Address,
        amount: i128,
        unlock_time: u64,
    ) -> Result<u64, ContractError> {
        // ── Validate amount ───────────────────────────────────────────────
        if amount <= 0 {
            panic!("{}", ContractError::InvalidAmount as u32);
        }

        // ── Validate unlock_time: enforce the 5-year hard cap ─────────────
        //
        // `checked_add` guards against the theoretical case where the ledger
        // timestamp is near u64::MAX. Falling back to u64::MAX means every
        // representable unlock time is accepted rather than panicking.
        let current_timestamp: u64 = env.ledger().timestamp();
        let max_timestamp: u64 = current_timestamp.saturating_add(MAX_LOCK_DURATION_SECONDS);

        if unlock_time > max_timestamp {
            panic!("{}", ContractError::LockTimeTooFarInFuture as u32);
        }

        // ── Authorise and pull funds ──────────────────────────────────────
        sender.require_auth();

        let token_address = get_token_address(&env);
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        // ── Persist the gift record ───────────────────────────────────────
        let gift_id = get_gift_counter(&env) + 1;
        set_gift_counter(&env, gift_id);

        let gift = Gift {
            sender: sender.clone(),
            recipient: recipient.clone(),
            amount,
            unlock_time,
            is_claimed: false,
        };
        set_gift(&env, gift_id, &gift);

        // ── Emit event ────────────────────────────────────────────────────
        emit_gift_created(&env, gift_id, &sender, &recipient, amount, unlock_time);

        Ok(gift_id)
    }

    /// Upgrades the current contract Wasm for the already initialized backend admin.
    ///
    /// The caller must be the admin recorded during initialization, and the
    /// upgrade must target a Wasm hash that has already been uploaded to the
    /// ledger via the deployer interface.
    pub fn upgrade_contract(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");

        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        Ok(())
    }
}
