use soroban_sdk::{contracttype, Address};

/// A time-locked gift record stored on-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Gift {
    /// Address that funded the gift.
    pub sender: Address,
    /// Address entitled to claim the gift.
    pub recipient: Address,
    /// USDC amount in stroops (7 decimal places).
    pub amount: i128,
    /// Ledger timestamp after which the gift may be claimed.
    pub unlock_time: u64,
    /// Whether the gift has already been claimed.
    pub is_claimed: bool,
}

/// Storage keys for the gift contract.
#[contracttype]
pub enum DataKey {
    /// The privileged admin address, set once at initialization.
    Admin,
    /// The USDC token contract address, set once at initialization.
    TokenAddress,

    /// Monotonically incrementing counter used to generate gift IDs.
    GiftCounter,

    /// Persistent record for a specific gift ID.
    GiftRecord(u64),
}
