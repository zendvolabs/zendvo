use soroban_sdk::{Address, Env};

use crate::savings::types::{DataKey, UserSavings};

pub fn get_user_savings(env: &Env, user: &Address) -> UserSavings {
    env.storage()
        .persistent()
        .get(&DataKey::UserSavingsRecord(user.clone()))
        .unwrap_or(UserSavings {
            principal: 0,
            yield_shares: 0,
        })
}

pub fn set_user_savings(env: &Env, user: &Address, record: &UserSavings) {
    env.storage()
        .persistent()
        .set(&DataKey::UserSavingsRecord(user.clone()), record);
}

pub fn get_token_address(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TokenAddress)
        .expect("token address not set")
}
