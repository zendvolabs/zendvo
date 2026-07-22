use soroban_sdk::{contracttype, Address};

#[contracttype]
pub enum DataKey {
    UserSavingsRecord(Address),
    TokenAddress,
}

#[contracttype]
pub struct UserSavings {
    pub principal: i128,
    pub yield_shares: i128,
}
