use soroban_sdk::contracterror;

/// Common error types used across all contract modules.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 5,
    NotInitialized = 6,
    GiftNotFound = 8,
    TimeLockNotExpired = 9,
    AlreadyClaimed = 10,
    AmountTooSmall = 11,
    InsufficientBalance = 12,

    /// The caller is not authorised to perform this action.
    Unauthorized = 1,

    /// The provided token amount is zero or negative.
    InvalidAmount = 2,

    /// The gift is still within its time-lock period and cannot be claimed yet.
    TimeLockActive = 3,

    /// The requested unlock timestamp is further in the future than the
    /// contract's hard cap (`MAX_LOCK_DURATION_SECONDS`), protecting users
    /// from accidentally locking funds for an unreasonable length of time.
    LockTimeTooFarInFuture = 4,

    /// Arithmetic overflow occurred while updating a balance.
    Overflow = 13,

    /// The user has no yield to claim; yield_shares is zero.
    NoYieldToClaim = 14,
}
