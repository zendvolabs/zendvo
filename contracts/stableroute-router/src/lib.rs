#![allow(deprecated)] // TODO: migrate Soroban events to #[contractevent].
#![no_std]
// Contributing? See CONTRIBUTING.md for error-numbering, event-topic, auth,
// pause, and storage/TTL conventions plus the PR checklist.

#[cfg(test)]
extern crate std;

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Bytes, BytesN, Env, Symbol, Vec,
};

/// Aggregated read of every pair-scoped storage slot (base fields).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PairInfo {
    pub registered: bool,
    pub fee_bps: u32,
    pub min_amount: i128,
    pub max_amount: i128,
    pub liquidity: i128,
    pub last_route_at: u64,
}

/// Extended aggregate read of every pair-scoped storage slot, including
/// cooldown, route count, and cumulative volume. See [`PairInfo`] for the
/// original (base) field set.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PairInfoExt {
    pub registered: bool,
    pub fee_bps: u32,
    pub min_amount: i128,
    pub max_amount: i128,
    pub liquidity: i128,
    pub last_route_at: u64,
    pub cooldown_secs: u64,
    pub route_count: u64,
    pub volume: i128,
}

/// Aggregated read of the queued admin handover: the proposed pending
/// admin and the earliest timestamp at which it may accept.
///
/// Returned by [`StableRouteRouter::get_pending_admin_info`] so watchers
/// get both slots from a single invocation. Both fields are `None` when
/// no transfer is queued.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingAdminInfo {
    /// Address proposed via `propose_admin_transfer`, if any.
    pub pending: Option<Address>,
    /// Earliest ledger timestamp at which the pending admin may call
    /// `accept_admin_transfer` (`propose` time + timelock), if queued.
    pub eta: Option<u64>,
}

/// Per-user savings account state: the user's originally deposited capital
/// (principal) is tracked separately from the cumulative yield they have
/// earned. This allows withdrawals to be attributed to principal or yield
/// independently, which matters for accounting and fee reporting.
///
/// Returned by [`StableRouteRouter::get_savings_info`] so users and
/// indexers can inspect both components of their savings balance.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SavingsInfo {
    /// The total amount the user has deposited (never decreases from
    /// withdrawals ÔÇö only grows via `deposit_savings`).
    pub principal: i128,
    /// Cumulative yield earned by this user, summed monotonically
    /// across all `accrue_yield` calls. Withdrawn via
    /// `withdraw_savings` which may deduct from this balance before
    /// touching principal.
    pub yield_earned: i128,
    /// Ledger timestamp of the most recent yield accrual for this user.
    /// Used to compute the next accrual increment as
    /// `principal * yield_rate_bps * elapsed / (YEAR_SECS * 10_000)`.
    /// Starts at the deposit timestamp and is updated on every
    /// `accrue_yield` call.
    pub last_accrued: u64,
}

/// Global savings configuration, stored as a single persistent slot.
///
/// Returned by [`StableRouteRouter::get_savings_config`] so watchers
/// can query the yield rate and aggregate totals in one read.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SavingsConfig {
    /// Annual yield rate in basis points (1 bps = 0.01 %). Capped at
    /// [`MAX_YIELD_RATE_BPS`] to bound per-accrual growth.
    pub yield_rate_bps: u32,
    /// Sum of all users' `principal` fields ÔÇö the total deposited
    /// capital tracked by the savings module.
    pub total_principal: i128,
    /// Sum of all users' `yield_earned` fields ÔÇö the total yield
    /// generated across all users.
    pub total_yield: i128,
    /// `true` once `init_savings` has been called. Guards all savings
    /// entrypoints so callers get a clear error instead of silently
    /// operating on absent config.
    pub initialized: bool,
}

/// Storage keys used by the StableRoute router. All twenty variants live
/// in persistent storage ÔÇö no instance or temporary storage is used today.
///
/// See [`docs/storage.md`] for the authoritative reference: key shape,
/// value type, default-when-absent, reader/writer entrypoints, and TTL
/// classification (Static / Config / Hot).
///
/// ## Sentinel conventions
///
/// - Absent `bool`  ÔåÆ `false` (pair registration, paused, reentrancy lock).
/// - `i128::MAX`      ÔåÆ "unbounded" sentinel for `PairMaxAmount` and for
///   liquidity *inside `compute_route_fee` only*.
/// - `0`              ÔåÆ default for counters, fees, timestamps (as `u64`),
///   `PairMinAmount`, and cooldowns.
/// - Absent `Option`  ÔåÆ `None` (admin, pending admin, fee recipient,
///   last-route timestamp, max fee absolute, oracle).
/// - `SchemaVersion`  ÔåÆ `1` when absent (the implicit pre-migration default).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Operational admin (singleton, `Address`, persistent).
    /// Set once by `__constructor`; only changed by a two-step handover
    /// (`propose_admin_transfer` ÔåÆ `accept_admin_transfer`).
    /// Absent reads panic with `NotInitialized` (#2).
    Admin,
    /// `true` if `(source, destination)` is a recognised route.
    /// Keyed per-pair; stored as `bool` so callers can query without
    /// distinguishing "absent" from "false". Defaults to `false`.
    Pair(Symbol, Symbol),
    /// Per-pair fee in basis points (1 bps = 0.01 %). Stored as `u32`
    /// so the on-the-wire shape is fixed; values above `MAX_FEE_BPS`
    /// are rejected at write time. Defaults to `0` (free).
    PairFeeBps(Symbol, Symbol),
    /// Pending admin proposed via `propose_admin_transfer` (singleton,
    /// `Address`, persistent). Two-step handover guards against locking
    /// the contract with a bad key. Absent Ôåö `None` (no handover queued).
    PendingAdmin,
    /// `true` when the router is paused (singleton, `bool`, persistent).
    /// All state-changing entrypoints reject calls until an unpause.
    /// Defaults to `false` (not paused).
    Paused,
    /// Minimum routable amount per pair in source units (keyed per-pair,
    /// `i128`, persistent). `compute_route_fee` rejects amounts below the
    /// floor. Defaults to `0` (no floor).
    PairMinAmount(Symbol, Symbol),
    /// Maximum routable amount per pair in source units (keyed per-pair,
    /// `i128`, persistent). `compute_route_fee` rejects amounts above the
    /// ceiling. Defaults to `i128::MAX` (no ceiling).
    PairMaxAmount(Symbol, Symbol),
    /// Reported available liquidity in source units per pair (keyed
    /// per-pair, `i128`, persistent). Updated by an off-chain oracle
    /// (or the admin) via `set_pair_liquidity`; decremented on every
    /// successful `compute_route_fee`. Default is context-dependent:
    /// `get_pair_liquidity` returns `0` for absent, while
    /// `compute_route_fee` treats absent as `i128::MAX` (unbounded).
    PairLiquidity(Symbol, Symbol),
    /// Address that receives protocol fees on settlement (singleton,
    /// `Address`, persistent). Absent Ôåö `None`.
    FeeRecipient,
    /// Protocol-wide lifetime counter of `compute_route_fee` invocations
    /// (singleton, `u64`, persistent). Incremented with `saturating_add`
    /// so it is monotonic and never panics. Defaults to `0`.
    TotalRoutesAllTime,
    /// Ledger timestamp of the most recent `compute_route_fee` for a
    /// pair (keyed per-pair, `u64`, persistent). Used by the cooldown
    /// rate-limit gate. Absent reads as `None` (`Option`); `get_pair_info`
    /// flattens it to `0`.
    PairLastRouteAt(Symbol, Symbol),
    /// Per-pair lifetime counter of `compute_route_fee` invocations
    /// (keyed per-pair, `u64`, persistent). Incremented with
    /// `saturating_add` so it is monotonic and never panics on overflow.
    /// Defaults to `0`.
    PairRouteCount(Symbol, Symbol),
    /// Per-pair cumulative routed volume ÔÇö sum of `amount` in source
    /// units (keyed per-pair, `i128`, persistent). Accumulated with
    /// `saturating_add` so it is monotonic and never panics on overflow.
    /// Defaults to `0`.
    PairVolume(Symbol, Symbol),
    /// On-chain storage schema version (singleton, `u32`, persistent).
    /// Distinct from `version()`. Defaults to `1` when absent (the
    /// implicit pre-migration layout). Advanced to `2` by
    /// `migrate_v1_to_v2`.
    SchemaVersion,
    /// Governance timelock delay in seconds (singleton, `u64`,
    /// persistent). When > 0, a proposed admin handover can only be
    /// accepted after the delay has elapsed. Defaults to `0` (instant)
    /// when unset, preserving prior behaviour.
    Timelock,
    /// Earliest ledger timestamp at which the currently pending admin
    /// transfer may be accepted ÔÇö `propose_admin_transfer` time + delay
    /// (singleton, `u64`, persistent). Absent Ôåö `None` (no handover
    /// queued).
    PendingAdminEta,
    /// Non-reentrancy guard (singleton, `bool`, persistent). Set to
    /// `true` before the write/event phase of `compute_route_fee` and
    /// cleared to `false` on exit. Defaults to `false`.
    ReentrancyLock,
    /// Per-pair cooldown in seconds between route accounting calls
    /// (keyed per-pair, `u64`, persistent). While non-zero,
    /// `compute_route_fee` rejects a call until at least this many
    /// seconds have elapsed since `PairLastRouteAt`. Capped at
    /// `MAX_COOLDOWN_SECS` (30 days). Defaults to `0` (disabled).
    PairCooldown(Symbol, Symbol),
    /// Optional absolute per-route fee ceiling (singleton, `i128`,
    /// persistent). When set, the effective fee is `min(bps_fee, cap)`.
    /// Absent Ôåö `None` (only the relative `MAX_FEE_BPS` bound applies).
    MaxFeeAbsolute,
    /// Scoped liquidity oracle address (singleton, `Address`,
    /// persistent). The oracle may call `set_pair_liquidity` and
    /// nothing else ÔÇö it cannot set fees, pause, rotate admin, or
    /// upgrade. Absent Ôåö `None` (no oracle configured ÔÇö admin-only
    /// liquidity feed).
    Oracle,
    /// Savings account state per user (keyed by `Address`, value is
    /// [`SavingsInfo`], persistent). Absent Ôåö no account exists for
    /// that address.
    SavingsAccount(Address),
    /// Global savings configuration (singleton, [`SavingsConfig`],
    /// persistent). Written once by `init_savings` and updated by
    /// `deposit_savings`, `accrue_yield`, `withdraw_savings`, and
    /// `set_yield_rate`. Absent Ôåö savings module not initialized.
    SavingsConfig,
}

/// Upper bound on the per-pair fee. 1 000 bps = 10 %. Tightening this
/// further is a governance decision; raising it is append-only safe
/// but should be deliberate.
pub const MAX_FEE_BPS: u32 = 1_000;
/// Basis-point denominator: 1 bps = 1/10_000.
pub const BPS_DENOMINATOR: i128 = 10_000;
/// Maximum number of entries in a single batch operation
/// (`register_pairs`, `set_pair_fees_bps`). Kept modest to bound
/// per-transaction gas costs.
pub const MAX_BATCH_SIZE: u32 = 100;
/// Upper bound on the per-pair route cooldown, in seconds (30 days).
/// `set_pair_cooldown` rejects any larger value so a fat-fingered or
/// malicious config write (e.g. `u64::MAX`) cannot permanently brick a
/// corridor by making `compute_route_fee`'s `last + cooldown` gate
/// unreachable. Ledger timestamps are seconds since epoch and are nowhere
/// near `u64::MAX - MAX_COOLDOWN_SECS`, so capping here also guarantees
/// the `last + cooldown` addition in `compute_route_fee` cannot overflow
/// `u64` for the foreseeable future.
pub const MAX_COOLDOWN_SECS: u64 = 2_592_000;
/// Upper bound on the annual yield rate in basis points (1 bps = 0.01 %).
/// 5 000 bps = 50 % per year ÔÇö generous enough for almost any realistic
/// DeFi yield product while bounding per-second accrual arithmetic so it
/// never overflows `i128` even on large principal values.
pub const MAX_YIELD_RATE_BPS: u32 = 5_000;
/// Seconds in a standard 365-day year (non-leap). Used in yield accrual:
/// `yield_increment = principal * yield_rate_bps * elapsed / (YEAR_SECS * 10_000)`.
pub const YEAR_SECS: u128 = 31_536_000;

/// Typed contract errors. Codes are append-only ÔÇö never reuse or
/// renumber a variant once it has shipped.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RouterError {
    /// `init` was called but the admin address is already stored.
    AlreadyInitialized = 1,
    /// A read or write expected the admin to be set but it was not.
    NotInitialized = 2,
    /// `register_pair` was called with `source == destination`.
    SourceEqualsDestination = 3,
    /// `set_pair_fee_bps` was called with a value above [`MAX_FEE_BPS`].
    FeeBpsTooHigh = 4,
    /// `compute_route_fee` was called for a pair that was never registered.
    PairNotRegistered = 5,
    /// `compute_route_fee` was called with a non-positive amount.
    AmountMustBePositive = 6,
    /// `accept_admin_transfer` was called with no pending admin.
    NoPendingAdminTransfer = 7,
    /// `accept_admin_transfer` was called by a non-pending address.
    NotPendingAdmin = 8,
    /// A state-changing entrypoint was called while paused.
    ContractPaused = 9,
    /// Amount is below the configured PairMinAmount.
    AmountBelowMin = 10,
    /// Amount is above the configured PairMaxAmount.
    AmountAboveMax = 11,
    /// Reported pair liquidity is below the requested amount.
    InsufficientLiquidity = 12,
    /// `migrate_v1_to_v2` was called from a non-v1 schema.
    MigrationVersionMismatch = 13,
    /// `accept_admin_transfer` was called before the governance timelock
    /// delay elapsed.
    TimelockNotElapsed = 14,
    /// A non-reentrant entrypoint was entered while already locked.
    ReentrantCall = 15,
    /// Caller was neither the admin nor the scoped oracle.
    NotAuthorized = 16,
    /// Per-pair cooldown has not elapsed since the last route.
    RouteCooldownActive = 17,
    /// `register_pairs` or `set_pair_fees_bps` was called with a batch
    /// exceeding [`MAX_BATCH_SIZE`] entries.
    BatchTooLarge = 18,
    /// `register_pairs` or `set_pair_fees_bps` was called with an empty
    /// batch.
    EmptyBatch = 19,
    /// `set_pair_cooldown` was called with a value above
    /// [`MAX_COOLDOWN_SECS`].
    CooldownTooLarge = 20,
    /// A savings entrypoint was called before `init_savings` was invoked.
    SavingsNotInitialized = 21,
    /// `withdraw_savings` was called with an amount exceeding the user's
    /// total balance (principal + yield_earned).
    InsufficientSavingsBalance = 22,
    /// `init_savings` was called after the savings module was already
    /// initialized (savings config already exists).
    SavingsAlreadyInitialized = 23,
    /// `init_savings` or `set_yield_rate` was called with a yield rate
    /// above [`MAX_YIELD_RATE_BPS`].
    YieldRateTooHigh = 24,
    /// `deposit_savings` or `withdraw_savings` was called with a non-positive
    /// amount.
    AmountMustBePositiveSavings = 25,
    /// `withdraw_savings` would leave dust below a minimum granularity.
    WithdrawalBelowMinimum = 26,
}

/// StableRoute router contract ÔÇö placeholder for routing logic.
/// In production this would integrate with path payments and liquidity data.
#[contract]
pub struct StableRouteRouter;

#[contractimpl]
impl StableRouteRouter {
    /// Load the admin address, require its auth, and return it.
    ///
    /// Every admin-gated entrypoint calls this instead of repeating the
    /// six-line load-unwrap-require_auth block. Keeping it private
    /// ensures it never appears in the generated client ABI.
    fn require_admin(env: &Env) -> Address {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, RouterError::NotInitialized));
        admin.require_auth();
        admin
    }

    /// Require that `(source, destination)` was previously registered via
    /// [`Self::register_pair`]; panics with
    /// [`RouterError::PairNotRegistered`] otherwise.
    ///
    /// Every per-pair config setter (`set_pair_fee_bps`,
    /// `set_pair_min_amount`, `set_pair_max_amount`, `set_pair_liquidity`)
    /// calls this after its own admin/sign validation so a config write can
    /// never create an orphan storage slot for a corridor an operator never
    /// registered. Reuses the same [`RouterError::PairNotRegistered`] (#5)
    /// that `compute_route_fee` and `quote_route` already raise, keeping
    /// one error code for "this pair does not exist" across the contract.
    fn require_pair_registered(env: &Env, source: &Symbol, destination: &Symbol) {
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Pair(source.clone(), destination.clone()))
            .unwrap_or(false)
        {
            panic_with_error!(env, RouterError::PairNotRegistered);
        }
    }

    /// Acquire the reentrancy lock; panics [`RouterError::ReentrantCall`]
    /// if already held. Paired with [`Self::exit_nonreentrant`] on every
    /// return path so that a re-entrant invocation (for example via a
    /// future malicious token callback) is rejected instead of operating
    /// on partially-applied effects.
    fn enter_nonreentrant(env: &Env) {
        if env
            .storage()
            .persistent()
            .get(&DataKey::ReentrancyLock)
            .unwrap_or(false)
        {
            panic_with_error!(env, RouterError::ReentrantCall);
        }
        env.storage()
            .persistent()
            .set(&DataKey::ReentrancyLock, &true);
    }

    /// Release the reentrancy lock. Must be called before every return
    /// from a guarded entrypoint, including the success path, so that
    /// back-to-back calls work.
    fn exit_nonreentrant(env: &Env) {
        env.storage()
            .persistent()
            .set(&DataKey::ReentrancyLock, &false);
    }

    /// Returns the router contract version.
    pub fn version(_env: Env) -> Symbol {
        symbol_short!("ROUTER_V2")
    }

    /// Read the persisted schema version, or 1 if absent (the implicit
    /// pre-migration default).
    pub fn get_schema_version(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(1)
    }

    /// Migrate the schema from v1 to v2. Admin-gated; panics with
    /// MigrationVersionMismatch on a non-v1 starting state. v2 readers
    /// default sensibly when their new slots are absent, so the body
    /// only stamps the new SchemaVersion.
    pub fn migrate_v1_to_v2(env: Env) {
        Self::require_admin(&env);
        let current: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(1);
        if current != 1 {
            panic_with_error!(&env, RouterError::MigrationVersionMismatch);
        }
        env.storage()
            .persistent()
            .set(&DataKey::SchemaVersion, &2u32);
    }

    /// Deploy-time constructor ÔÇö sets the operational admin **atomically**
    /// at contract instantiation.
    ///
    /// Running as the constructor closes the init front-running window:
    /// the admin slot is written in the same transaction that deploys the
    /// contract (`register(StableRouteRouter, (admin,))`), so there is no
    /// observable deployed-but-uninitialized state for an attacker to race
    /// a separate `init` call into. Requires `admin.require_auth()` and
    /// emits the `init` event for indexers.
    pub fn __constructor(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.events().publish((symbol_short!("init"),), admin);
    }

    /// Legacy initializer, retained for ABI compatibility only.
    ///
    /// The admin is now set by [`Self::__constructor`] at deploy time, so
    /// the slot is always populated and this entrypoint can never claim
    /// it. It unconditionally panics with
    /// [`RouterError::AlreadyInitialized`], preserving the historical
    /// `#1` semantics for any client still calling `init` post-deploy and
    /// guaranteeing an attacker can never seize the admin role via `init`.
    pub fn init(env: Env, admin: Address) {
        let _ = admin;
        panic_with_error!(&env, RouterError::AlreadyInitialized);
    }

    /// Returns true iff the router is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Resume after a pause. Admin-gated and idempotent.
    pub fn unpause(env: Env) {
        Self::require_admin(&env);
        env.storage().persistent().set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("paused"),), false);
    }

    /// Admin pauses the router. All state-changing entrypoints will
    /// then panic with ContractPaused.
    pub fn pause(env: Env) {
        Self::require_admin(&env);
        env.storage().persistent().set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), true);
    }

    /// Read the configured governance timelock delay, in seconds
    /// (0 when unset ÔÇö handover is instant).
    pub fn get_timelock(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Timelock)
            .unwrap_or(0)
    }

    /// Admin sets the governance timelock delay (seconds). Applies to the
    /// **next** `propose_admin_transfer`; already-queued actions keep the
    /// eta they were stamped with. Pass 0 to disable (instant handover).
    pub fn set_timelock(env: Env, delay_seconds: u64) {
        Self::require_admin(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Timelock, &delay_seconds);
    }

    /// Read the earliest timestamp at which the pending admin transfer may
    /// be accepted, or `None` when no transfer is queued.
    pub fn get_pending_admin_eta(env: Env) -> Option<u64> {
        env.storage().persistent().get(&DataKey::PendingAdminEta)
    }

    /// Cancel a pending handover, clearing both the pending admin and its
    /// queued eta. No-op if none is pending.
    pub fn cancel_admin_transfer(env: Env) {
        Self::require_admin(&env);
        env.storage().persistent().remove(&DataKey::PendingAdmin);
        env.storage().persistent().remove(&DataKey::PendingAdminEta);
    }

    /// Read the pending admin if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::PendingAdmin)
    }

    /// Read both components of the queued admin handover in one call.
    ///
    /// Returns a consistent snapshot of the pending admin and its
    /// earliest acceptance timestamp (ETA). Both fields are `None`
    /// when no transfer is queued.
    pub fn get_pending_admin_info(env: Env) -> PendingAdminInfo {
        let s = env.storage().persistent();
        PendingAdminInfo {
            pending: s.get(&DataKey::PendingAdmin),
            eta: s.get(&DataKey::PendingAdminEta),
        }
    }

    /// Step 2 of admin handover. The pending admin claims the role
    /// from their own key. Panics with NoPendingAdminTransfer if none
    /// is pending or NotPendingAdmin if the caller does not match.
    pub fn accept_admin_transfer(env: Env, caller: Address) {
        caller.require_auth();
        let pending: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PendingAdmin)
            .unwrap_or_else(|| panic_with_error!(&env, RouterError::NoPendingAdminTransfer));
        if pending != caller {
            panic_with_error!(&env, RouterError::NotPendingAdmin);
        }
        // Honour the governance timelock: the handover cannot execute until
        // its stamped eta has been reached.
        let eta: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::PendingAdminEta)
            .unwrap_or(0);
        if env.ledger().timestamp() < eta {
            panic_with_error!(&env, RouterError::TimelockNotElapsed);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Admin, &caller.clone());
        env.storage().persistent().remove(&DataKey::PendingAdmin);
        env.storage().persistent().remove(&DataKey::PendingAdminEta);
        env.events().publish((symbol_short!("executed"),), caller);
    }

    /// Step 1 of admin handover. Current admin proposes a new admin;
    /// the new admin must then accept via `accept_admin_transfer` once the
    /// governance timelock (if any) has elapsed.
    ///
    /// Stamps `PendingAdminEta = now + timelock` and emits a `queued`
    /// event carrying the new admin and the eta so watchers get a warning
    /// window before control can actually change hands.
    pub fn propose_admin_transfer(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        let delay: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Timelock)
            .unwrap_or(0);
        let eta = env.ledger().timestamp().saturating_add(delay);
        env.storage()
            .persistent()
            .set(&DataKey::PendingAdmin, &new_admin.clone());
        env.storage()
            .persistent()
            .set(&DataKey::PendingAdminEta, &eta);
        env.events()
            .publish((symbol_short!("queued"),), (new_admin, eta));
    }

    /// Force-complete an admin handover after the timelock has elapsed,
    /// without requiring the new admin to call `accept_admin_transfer`.
    ///
    /// Admin-gated. Requires that `propose_admin_transfer` was already
    /// called with the same `new_admin` and that the timelock delay has
    /// elapsed. Emits the same `executed` event as `accept_admin_transfer`
    /// so indexers can treat it identically.
    pub fn force_admin_transfer(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        let pending: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PendingAdmin)
            .unwrap_or_else(|| panic_with_error!(&env, RouterError::NoPendingAdminTransfer));
        if pending != new_admin {
            panic_with_error!(&env, RouterError::NotPendingAdmin);
        }
        let eta: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::PendingAdminEta)
            .unwrap_or(0);
        if env.ledger().timestamp() < eta {
            panic_with_error!(&env, RouterError::TimelockNotElapsed);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Admin, &new_admin.clone());
        env.storage().persistent().remove(&DataKey::PendingAdmin);
        env.storage().persistent().remove(&DataKey::PendingAdminEta);
        env.events()
            .publish((symbol_short!("executed"),), new_admin);
    }

    /// Returns the admin set at `init`, if any.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Admin)
    }

    /// Register `(source, destination)` as a recognised route.
    ///
    /// Admin-gated; rejects `source == destination`. Idempotent: a
    /// second call with the same pair simply re-asserts the entry and
    /// is a no-op from the caller's perspective.
    ///
    /// **Registration-first invariant:** `set_pair_fee_bps`,
    /// `set_pair_min_amount`, `set_pair_max_amount`, and
    /// `set_pair_liquidity` all require the pair to already be registered
    /// here, and panic with [`RouterError::PairNotRegistered`] (#5)
    /// otherwise. Always call `register_pair` before configuring a
    /// corridor's fee, bounds, or liquidity.
    pub fn register_pair(env: Env, source: Symbol, destination: Symbol) {
        if env
            .storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, RouterError::ContractPaused);
        }
        Self::require_admin(&env);
        if source == destination {
            panic_with_error!(&env, RouterError::SourceEqualsDestination);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Pair(source.clone(), destination.clone()), &true);
        env.events()
            .publish((symbol_short!("pair_reg"),), (source, destination));
    }

    /// Register multiple `(source, destination)` pairs in a single
    /// admin-gated call. Each entry is validated identically to
    /// [`Self::register_pair`] and gets its own `pair_reg` event.
    ///
    /// **All-or-nothing:** if any entry fails validation the entire
    /// transaction is rolled back (Soroban transactions are atomic), so
    /// callers must ensure every pair is valid before invoking this. The
    /// batch must contain at least one entry; an empty batch panics with
    /// [`RouterError::EmptyBatch`]. The batch is also capped at
    /// [`MAX_BATCH_SIZE`] entries to bound gas; exceeding it panics with
    /// [`RouterError::BatchTooLarge`].
    pub fn register_pairs(env: Env, pairs: Vec<(Symbol, Symbol)>) {
        if env
            .storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, RouterError::ContractPaused);
        }
        Self::require_admin(&env);
        if pairs.is_empty() {
            panic_with_error!(&env, RouterError::EmptyBatch);
        }
        if pairs.len() > MAX_BATCH_SIZE {
            panic_with_error!(&env, RouterError::BatchTooLarge);
        }
        for (source, destination) in pairs.iter() {
            if source == destination {
                panic_with_error!(&env, RouterError::SourceEqualsDestination);
            }
            env.storage()
                .persistent()
                .set(&DataKey::Pair(source.clone(), destination.clone()), &true);
            env.events()
                .publish((symbol_short!("pair_reg"),), (source, destination));
        }
    }

    /// Returns true iff the pair is registered AND has non-zero
    /// reported liquidity. Useful as a quick is-routable check.
    pub fn is_pair_active(env: Env, source: Symbol, destination: Symbol) -> bool {
        let s = env.storage().persistent();
        if !s
            .get::<_, bool>(&DataKey::Pair(source.clone(), destination.clone()))
            .unwrap_or(false)
        {
            return false;
        }
        s.get::<_, i128>(&DataKey::PairLiquidity(source, destination))
            .unwrap_or(0)
            > 0
    }

    /// Single round-trip aggregate read for the dashboard. Returns
    /// every per-pair slot in one shot.
    pub fn get_pair_info(env: Env, source: Symbol, destination: Symbol) -> PairInfo {
        let s = env.storage().persistent();
        PairInfo {
            registered: s
                .get(&DataKey::Pair(source.clone(), destination.clone()))
                .unwrap_or(false),
            fee_bps: s
                .get(&DataKey::PairFeeBps(source.clone(), destination.clone()))
                .unwrap_or(0),
            min_amount: s
                .get(&DataKey::PairMinAmount(source.clone(), destination.clone()))
                .unwrap_or(0),
            max_amount: s
                .get(&DataKey::PairMaxAmount(source.clone(), destination.clone()))
                .unwrap_or(i128::MAX),
            liquidity: s
                .get(&DataKey::PairLiquidity(source.clone(), destination.clone()))
                .unwrap_or(0),
            last_route_at: s
                .get(&DataKey::PairLastRouteAt(source, destination))
                .unwrap_or(0),
        }
    }

    /// Extended aggregate read including newer per-pair slots that were
    /// added after the original [`PairInfo`] shipped. Returns every
    /// per-pair slot in a single round-trip so dashboards avoid issuing
    /// separate calls for cooldown, route count, and volume.
    ///
    /// Defaults follow the same sentinel conventions as the individual
    /// getters: cooldown 0 (disabled), route count 0, volume 0.
    pub fn get_pair_info_ext(env: Env, source: Symbol, destination: Symbol) -> PairInfoExt {
        let s = env.storage().persistent();
        PairInfoExt {
            registered: s
                .get(&DataKey::Pair(source.clone(), destination.clone()))
                .unwrap_or(false),
            fee_bps: s
                .get(&DataKey::PairFeeBps(source.clone(), destination.clone()))
                .unwrap_or(0),
            min_amount: s
                .get(&DataKey::PairMinAmount(source.clone(), destination.clone()))
                .unwrap_or(0),
            max_amount: s
                .get(&DataKey::PairMaxAmount(source.clone(), destination.clone()))
                .unwrap_or(i128::MAX),
            liquidity: s
                .get(&DataKey::PairLiquidity(source.clone(), destination.clone()))
                .unwrap_or(0),
            last_route_at: s
                .get(&DataKey::PairLastRouteAt(
                    source.clone(),
                    destination.clone(),
                ))
                .unwrap_or(0),
            cooldown_secs: s
                .get(&DataKey::PairCooldown(source.clone(), destination.clone()))
                .unwrap_or(0),
            route_count: s
                .get(&DataKey::PairRouteCount(
                    source.clone(),
                    destination.clone(),
                ))
                .unwrap_or(0),
            volume: s
                .get(&DataKey::PairVolume(source, destination))
                .unwrap_or(0),
        }
    }

    /// Read-only quote of fee + net for a pair without writing the
    /// timestamp / counter. Useful as a planner-only hook.
    pub fn quote_route(
        env: Env,
        source: Symbol,
        destination: Symbol,
        amount: i128,
    ) -> (i128, i128) {
        if amount <= 0 {
            panic_with_error!(&env, RouterError::AmountMustBePositive);
        }
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Pair(source.clone(), destination.clone()))
            .unwrap_or(false)
        {
            panic_with_error!(&env, RouterError::PairNotRegistered);
        }
        let fee_bps: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PairFeeBps(source, destination))
            .unwrap_or(0);
        let fee = amount
            .checked_mul(fee_bps as i128)
            .map(|n| n / BPS_DENOMINATOR)
            .unwrap_or(0);
        let fee = Self::apply_fee_cap(&env, fee);
        (fee, amount - fee)
    }

    /// Read the most recent ledger timestamp at which `compute_route_fee`
    /// touched this pair. None when never routed.
    pub fn get_pair_last_route_at(env: Env, source: Symbol, destination: Symbol) -> Option<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::PairLastRouteAt(source, destination))
    }

    /// Admin sets the per-pair route cooldown in seconds.
    ///
    /// While set to a non-zero value, `compute_route_fee` rejects a call
    /// for the pair until at least `cooldown_secs` seconds have elapsed
    /// since the pair's last successful route (`PairLastRouteAt`).
    /// Setting `0` (the default) disables the rate limit for the pair.
    /// Rejects values above [`MAX_COOLDOWN_SECS`] with
    /// [`RouterError::CooldownTooLarge`] so an absurdly large value
    /// (e.g. `u64::MAX`) cannot permanently brick the corridor.
    pub fn set_pair_cooldown(env: Env, source: Symbol, destination: Symbol, cooldown_secs: u64) {
        Self::require_admin(&env);
        if cooldown_secs > MAX_COOLDOWN_SECS {
            panic_with_error!(&env, RouterError::CooldownTooLarge);
        }
        Self::require_pair_registered(&env, &source, &destination);
        env.storage().persistent().set(
            &DataKey::PairCooldown(source.clone(), destination.clone()),
            &cooldown_secs,
        );
        env.events().publish(
            (symbol_short!("cd_set"),),
            (source, destination, cooldown_secs),
        );
    }

    /// Read the per-pair route cooldown in seconds (0 when absent,
    /// meaning the rate limit is disabled for the pair).
    pub fn get_pair_cooldown(env: Env, source: Symbol, destination: Symbol) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::PairCooldown(source, destination))
            .unwrap_or(0)
    }

    /// Read the protocol-wide lifetime counter of route quotes.
    pub fn get_total_routes_all_time(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalRoutesAllTime)
            .unwrap_or(0)
    }

    /// Read the per-pair lifetime count of `compute_route_fee`
    /// invocations for `(source, destination)`. Returns 0 when the pair
    /// has never been routed.
    pub fn get_pair_route_count(env: Env, source: Symbol, destination: Symbol) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::PairRouteCount(source, destination))
            .unwrap_or(0)
    }

    /// Read the per-pair cumulative routed volume (sum of `amount` in
    /// source units) for `(source, destination)`. Returns 0 when the
    /// pair has never been routed.
    pub fn get_pair_volume(env: Env, source: Symbol, destination: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::PairVolume(source, destination))
            .unwrap_or(0)
    }

    /// Admin sets the address that receives protocol fees at
    /// settlement time. The router itself never custodies funds.
    pub fn set_fee_recipient(env: Env, recipient: Address) {
        Self::require_admin(&env);
        env.storage()
            .persistent()
            .set(&DataKey::FeeRecipient, &recipient);
    }

    /// Read the configured fee recipient, if any.
    pub fn get_fee_recipient(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::FeeRecipient)
    }

    /// Clamp `fee` to the configured absolute ceiling when one is set.
    /// Both the relative `MAX_FEE_BPS` bound and this absolute bound apply;
    /// the tighter of the two wins. No-op when no absolute cap is configured.
    fn apply_fee_cap(env: &Env, fee: i128) -> i128 {
        match env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::MaxFeeAbsolute)
        {
            Some(cap) => fee.min(cap),
            None => fee,
        }
    }

    /// Read the absolute per-route fee ceiling, or `None` when unset.
    pub fn get_max_fee_absolute(env: Env) -> Option<i128> {
        env.storage().persistent().get(&DataKey::MaxFeeAbsolute)
    }

    /// Admin sets the absolute per-route fee ceiling (in source units).
    /// Rejects negative caps with `AmountMustBePositive` (#6). A cap of `0`
    /// makes every route effectively free. Emits a `maxfee` event. The cap
    /// composes with `MAX_FEE_BPS`: a route is charged
    /// `min(amount * fee_bps / 10_000, max_fee_absolute)`.
    pub fn set_max_fee_absolute(env: Env, max_fee: i128) {
        Self::require_admin(&env);
        if max_fee < 0 {
            panic_with_error!(&env, RouterError::AmountMustBePositive);
        }
        env.storage()
            .persistent()
            .set(&DataKey::MaxFeeAbsolute, &max_fee);
        env.events().publish((symbol_short!("maxfee"),), max_fee);
    }

    /// Read the reported liquidity for a pair (0 when absent).
    pub fn get_pair_liquidity(env: Env, source: Symbol, destination: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::PairLiquidity(source, destination))
            .unwrap_or(0)
    }

    /// Read the configured liquidity oracle, if any.
    pub fn get_oracle(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Oracle)
    }

    /// Admin sets (or rotates) the scoped liquidity oracle.
    ///
    /// Admin-gated. The oracle may update pair liquidity via
    /// [`Self::set_pair_liquidity`] and **nothing else** ÔÇö it cannot set
    /// fees, pause, rotate admin, or upgrade. Emits `oracle_set`.
    pub fn set_oracle(env: Env, oracle: Address) {
        Self::require_admin(&env);
        env.storage().persistent().set(&DataKey::Oracle, &oracle);
        // Topic shortened to satisfy the 9-char `symbol_short!` limit.
        env.events().publish((symbol_short!("orac_set"),), oracle);
    }

    /// Admin revokes the scoped liquidity oracle.
    ///
    /// Admin-gated (panics with [`RouterError::NotInitialized`] (#2) when
    /// no admin is set, like every other admin entrypoint). Removes
    /// `DataKey::Oracle` so [`Self::set_pair_liquidity`] once again
    /// accepts **only the admin**: its dual-auth check
    /// (`caller != admin && Some(caller) != oracle`) naturally degrades to
    /// admin-only when the slot is absent, because `Some(caller)` can
    /// never equal `None`. This is the recovery path for a compromised
    /// oracle key ÔÇö unlike [`Self::set_oracle`] (which can only rotate to
    /// a new address, leaving *some* oracle authorized), `remove_oracle`
    /// returns the contract to an admin-only liquidity feed.
    ///
    /// Idempotent: removing when no oracle is configured is a clean
    /// no-op. Emits `orac_rm` carrying the previously configured oracle
    /// (`None` on a no-op) so indexers can audit revocations.
    pub fn remove_oracle(env: Env) {
        Self::require_admin(&env);
        let removed: Option<Address> = env.storage().persistent().get(&DataKey::Oracle);
        env.storage().persistent().remove(&DataKey::Oracle);
        env.events().publish((symbol_short!("orac_rm"),), removed);
    }

    /// Set the reported liquidity for a pair (source units).
    ///
    /// Dual-authorized: `caller` must be **either** the admin **or** the
    /// configured oracle, and must `require_auth()`. This implements
    /// least privilege ÔÇö the frequently rotated oracle key can keep the
    /// liquidity feed fresh without holding governance power. When no
    /// oracle is configured (never set, or revoked via
    /// [`Self::remove_oracle`]) the `Some(caller) != oracle` comparison is
    /// always true, so only the admin is accepted. Any other
    /// caller is rejected with [`RouterError::NotAuthorized`].
    ///
    /// Requires the pair to already be registered via
    /// [`Self::register_pair`]; rejects an unregistered pair with
    /// [`RouterError::PairNotRegistered`] (#5) so liquidity can never be
    /// configured for a corridor that was never (or no longer) enabled.
    pub fn set_pair_liquidity(
        env: Env,
        caller: Address,
        source: Symbol,
        destination: Symbol,
        liquidity: i128,
    ) {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, RouterError::NotInitialized));
        let oracle: Option<Address> = env.storage().persistent().get(&DataKey::Oracle);
        if caller != admin && Some(caller.clone()) != oracle {
            panic_with_error!(&env, RouterError::NotAuthorized);
        }
        if liquidity < 0 {
            panic_with_error!(&env, RouterError::AmountMustBePositive);
        }
        Self::require_pair_registered(&env, &source, &destination);
        env.storage().persistent().set(
            &DataKey::PairLiquidity(source.clone(), destination.clone()),
            &liquidity,
        );
        env.events().publish(
            (symbol_short!("liq_set"),),
            (source, destination, liquidity),
        );
    }

    /// Read the per-pair maximum (i128::MAX when absent).
    pub fn get_pair_max_amount(env: Env, source: Symbol, destination: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::PairMaxAmount(source, destination))
            .unwrap_or(i128::MAX)
    }

    /// Admin sets the per-pair maximum routable amount.
    ///
    /// Requires the pair to already be registered via
    /// [`Self::register_pair`]; rejects an unregistered pair with
    /// [`RouterError::PairNotRegistered`] (#5) so the maximum can never be
    /// configured for a corridor that was never (or no longer) enabled.
    pub fn set_pair_max_amount(env: Env, source: Symbol, destination: Symbol, max_amount: i128) {
        Self::require_admin(&env);
        if max_amount <= 0 {
            panic_with_error!(&env, RouterError::AmountMustBePositive);
        }
        Self::require_pair_registered(&env, &source, &destination);
        env.storage()
            .persistent()
            .set(&DataKey::PairMaxAmount(source, destination), &max_amount);
    }

    /// Read the per-pair minimum (0 when absent).
    pub fn get_pair_min_amount(env: Env, source: Symbol, destination: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::PairMinAmount(source, destination))
            .unwrap_or(0)
    }

    /// Admin sets the per-pair minimum routable amount.
    ///
    /// Requires the pair to already be registered via
    /// [`Self::register_pair`]; rejects an unregistered pair with
    /// [`RouterError::PairNotRegistered`] (#5) so the minimum can never be
    /// configured for a corridor that was never (or no longer) enabled.
    pub fn set_pair_min_amount(env: Env, source: Symbol, destination: Symbol, min_amount: i128) {
        Self::require_admin(&env);
        if min_amount < 0 {
            panic_with_error!(&env, RouterError::AmountMustBePositive);
        }
        Self::require_pair_registered(&env, &source, &destination);
        env.storage()
            .persistent()
            .set(&DataKey::PairMinAmount(source, destination), &min_amount);
    }

    /// Clear all pair-scoped config that should not survive unregister + re-register.
    ///
    /// This intentionally excludes route counters, cumulative volume, and last-route timestamp;
    /// those operational-history slots are tracked separately from live pair configuration.
    fn clear_pair_config(env: &Env, source: Symbol, destination: Symbol) {
        let storage = env.storage().persistent();
        storage.remove(&DataKey::PairFeeBps(source.clone(), destination.clone()));
        storage.remove(&DataKey::PairMinAmount(source.clone(), destination.clone()));
        storage.remove(&DataKey::PairMaxAmount(source.clone(), destination.clone()));
        storage.remove(&DataKey::PairLiquidity(source.clone(), destination.clone()));
        storage.remove(&DataKey::PairCooldown(source, destination));
    }

    /// Unregister a previously-registered pair. Admin-gated and idempotent.
    ///
    /// Also clears the pair's fee, min amount, max amount, and liquidity config slots so
    /// re-registering the same corridor starts from documented defaults instead of reviving
    /// stale config.
    pub fn unregister_pair(env: Env, source: Symbol, destination: Symbol) {
        Self::require_admin(&env);
        env.storage()
            .persistent()
            .remove(&DataKey::Pair(source.clone(), destination.clone()));
        Self::clear_pair_config(&env, source.clone(), destination.clone());
        env.events().publish(
            (symbol_short!("unreg"),),
            (source.clone(), destination.clone()),
        );
        env.events()
            .publish((symbol_short!("cfg_clr"),), (source, destination));
    }

    /// Explicitly reset a pair's operational-history metrics: `PairRouteCount`,
    /// `PairVolume`, and `PairLastRouteAt`. Admin-gated.
    ///
    /// By default, `unregister_pair` deliberately preserves these metrics so a
    /// pair's lifetime history survives a transient unregister/register cycle.
    /// This entrypoint is the explicit, opt-in way to discard that history ÔÇö
    /// call it (before or after `unregister_pair` + `register_pair`) when a
    /// re-listed corridor should start a fresh operational life instead of
    /// inheriting stale route counts and volume from its previous listing.
    ///
    /// Does not touch pair registration (`Pair`) or config (fee/bounds/
    /// liquidity, see `clear_pair_config`) ÔÇö only the three metrics slots.
    pub fn purge_pair_metrics(env: Env, source: Symbol, destination: Symbol) {
        Self::require_admin(&env);
        let storage = env.storage().persistent();
        storage.remove(&DataKey::PairRouteCount(
            source.clone(),
            destination.clone(),
        ));
        storage.remove(&DataKey::PairVolume(source.clone(), destination.clone()));
        storage.remove(&DataKey::PairLastRouteAt(
            source.clone(),
            destination.clone(),
        ));
        env.events()
            .publish((symbol_short!("pair_mrst"),), (source, destination));
    }

    /// Returns `true` iff `register_pair` has been called for this pair.
    pub fn is_pair_registered(env: Env, source: Symbol, destination: Symbol) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Pair(source, destination))
            .unwrap_or(false)
    }

    /// Set the routing fee in basis points for a registered pair.
    ///
    /// Admin-gated. Rejects values above [`MAX_FEE_BPS`] with
    /// [`RouterError::FeeBpsTooHigh`]. Idempotent: setting the same
    /// fee twice is a re-assert and harmless.
    ///
    /// Requires the pair to already be registered via
    /// [`Self::register_pair`]; rejects an unregistered pair with
    /// [`RouterError::PairNotRegistered`] (#5) so the fee can never be
    /// configured for a corridor that was never (or no longer) enabled.
    pub fn set_pair_fee_bps(env: Env, source: Symbol, destination: Symbol, fee_bps: u32) {
        if env
            .storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, RouterError::ContractPaused);
        }
        Self::require_admin(&env);
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, RouterError::FeeBpsTooHigh);
        }
        Self::require_pair_registered(&env, &source, &destination);
        env.storage().persistent().set(
            &DataKey::PairFeeBps(source.clone(), destination.clone()),
            &fee_bps,
        );
        env.events()
            .publish((symbol_short!("fee_set"),), (source, destination, fee_bps));
    }

    /// Set the routing fee in basis points for multiple registered pairs
    /// in a single admin-gated call. Each entry is validated identically
    /// to [`Self::set_pair_fee_bps`] and gets its own `fee_set` event.
    ///
    /// **All-or-nothing:** if any entry fails validation the entire
    /// transaction is rolled back (Soroban transactions are atomic), so
    /// callers must ensure every entry is well-formed before invoking
    /// this. Requires at least one entry; an empty batch panics with
    /// [`RouterError::EmptyBatch`]. Capped at [`MAX_BATCH_SIZE`] entries;
    /// exceeding it panics with [`RouterError::BatchTooLarge`].
    pub fn set_pair_fees_bps(env: Env, entries: Vec<(Symbol, Symbol, u32)>) {
        if env
            .storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, RouterError::ContractPaused);
        }
        Self::require_admin(&env);
        if entries.is_empty() {
            panic_with_error!(&env, RouterError::EmptyBatch);
        }
        if entries.len() > MAX_BATCH_SIZE {
            panic_with_error!(&env, RouterError::BatchTooLarge);
        }
        for (source, destination, fee_bps) in entries.iter() {
            if fee_bps > MAX_FEE_BPS {
                panic_with_error!(&env, RouterError::FeeBpsTooHigh);
            }
            Self::require_pair_registered(&env, &source, &destination);
            env.storage().persistent().set(
                &DataKey::PairFeeBps(source.clone(), destination.clone()),
                &fee_bps,
            );
            env.events()
                .publish((symbol_short!("fee_set"),), (source, destination, fee_bps));
        }
    }

    /// Returns the configured fee in basis points for a pair, or 0 if
    /// no fee has been set (a registered pair with no fee is free).
    pub fn get_pair_fee_bps(env: Env, source: Symbol, destination: Symbol) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PairFeeBps(source, destination))
            .unwrap_or(0)
    }

    /// Compute the fee in source units for routing `amount` through the
    /// `(source, destination)` pair.
    ///
    /// Rejects unregistered pairs with [`RouterError::PairNotRegistered`]
    /// and non-positive amounts with [`RouterError::AmountMustBePositive`]
    /// so off-chain callers always get a clear typed error instead of a
    /// silent zero. Math is integer division (truncating toward zero),
    /// matching every existing Stellar fee accounting precedent.
    ///
    /// Honours the emergency stop: while the router is paused this
    /// entrypoint panics with [`RouterError::ContractPaused`] so no route
    /// can be recorded (the `TotalRoutesAllTime` counter, the
    /// `PairLastRouteAt` stamp, and the `route` event are all gated). The
    /// read-only `quote_route` is intentionally left available while
    /// paused so integrators can keep planning routes for when the router
    /// resumes.
    ///
    /// # Checks/effects ordering
    ///
    /// Registered-pair, amount-bound, liquidity, and cooldown guards all
    /// pass before any route business effect is applied. Only after those
    /// checks does the function debit liquidity, update counters and
    /// timestamps, and emit route events.
    ///
    /// # Liquidity consumption
    ///
    /// After passing all pre-condition checks, the function debits `amount`
    /// from the stored `PairLiquidity` via saturating subtraction. If the
    /// liquidity slot is unset (i.e. reads as `i128::MAX` ÔÇö the unbounded
    /// sentinel) the decrement is skipped entirely, preserving the "no
    /// oracle configured" behaviour. When a decrement does occur a
    /// `liq_used` event carrying `(source, destination, remaining_liquidity)`
    /// is emitted. The slot TTL is extended on each write.
    pub fn compute_route_fee(env: Env, source: Symbol, destination: Symbol, amount: i128) -> i128 {
        if env
            .storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, RouterError::ContractPaused);
        }
        if amount <= 0 {
            panic_with_error!(env, RouterError::AmountMustBePositive);
        }

        // CHECKS: all state-dependent preconditions stay read-only so a
        // rejected route leaves no storage write or event behind.
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Pair(source.clone(), destination.clone()))
            .unwrap_or(false)
        {
            panic_with_error!(env, RouterError::PairNotRegistered);
        }
        let min_amount: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PairMinAmount(source.clone(), destination.clone()))
            .unwrap_or(0);
        if amount < min_amount {
            panic_with_error!(env, RouterError::AmountBelowMin);
        }
        let max_amount: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PairMaxAmount(source.clone(), destination.clone()))
            .unwrap_or(i128::MAX);
        if amount > max_amount {
            panic_with_error!(env, RouterError::AmountAboveMax);
        }
        let liquidity: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PairLiquidity(source.clone(), destination.clone()))
            .unwrap_or(i128::MAX);
        if amount > liquidity {
            panic_with_error!(env, RouterError::InsufficientLiquidity);
        }

        // Per-pair rate limit. A non-zero cooldown forces a minimum gap
        // between successive routes for the pair. The first route (no
        // recorded timestamp) is always allowed; cooldown == 0 disables
        // the check entirely, preserving the prior behaviour. Compare via
        // addition (last + cooldown) rather than subtraction to avoid any
        // u64 underflow. `last + cooldown` cannot overflow u64 either:
        // `set_pair_cooldown` rejects any `cooldown` above
        // `MAX_COOLDOWN_SECS` (30 days), and `last` is a ledger timestamp
        // (seconds since epoch) that would need to be within 30 days of
        // `u64::MAX` ÔÇö many orders of magnitude beyond any plausible
        // ledger closing time ÔÇö before this addition could wrap.
        let cooldown: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::PairCooldown(source.clone(), destination.clone()))
            .unwrap_or(0);
        if cooldown > 0 {
            if let Some(last) = env
                .storage()
                .persistent()
                .get::<_, u64>(&DataKey::PairLastRouteAt(
                    source.clone(),
                    destination.clone(),
                ))
            {
                if env.ledger().timestamp() < last + cooldown {
                    panic_with_error!(&env, RouterError::RouteCooldownActive);
                }
            }
        }

        // Acquire the reentrancy lock only after all route guards pass,
        // immediately before the write/event phase.
        Self::enter_nonreentrant(&env);

        // EFFECTS: after all route guards above have passed, debit
        // liquidity, write counters/timestamps, and emit events.
        // When no oracle has set a liquidity value the pair is treated as
        // unbounded ÔÇö no decrement and no liq_used event are emitted.
        if liquidity != i128::MAX {
            let remaining = liquidity.saturating_sub(amount);
            env.storage().persistent().set(
                &DataKey::PairLiquidity(source.clone(), destination.clone()),
                &remaining,
            );
            env.events().publish(
                (symbol_short!("liq_used"),),
                (source.clone(), destination.clone(), remaining),
            );
        }
        let total: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalRoutesAllTime)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::TotalRoutesAllTime, &total.saturating_add(1));
        let pair_count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::PairRouteCount(
                source.clone(),
                destination.clone(),
            ))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::PairRouteCount(source.clone(), destination.clone()),
            &pair_count.saturating_add(1),
        );
        let pair_volume: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PairVolume(source.clone(), destination.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::PairVolume(source.clone(), destination.clone()),
            &pair_volume.saturating_add(amount),
        );
        env.storage().persistent().set(
            &DataKey::PairLastRouteAt(source.clone(), destination.clone()),
            &env.ledger().timestamp(),
        );
        env.events().publish(
            (symbol_short!("route"),),
            (source.clone(), destination.clone(), amount),
        );
        let fee_bps: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PairFeeBps(source, destination))
            .unwrap_or(0);
        // amount * fee_bps / 10_000, in i128 to avoid u32*i128 overflow on
        // amounts near i128::MAX. fee_bps is capped at MAX_FEE_BPS so the
        // multiplication is bounded.
        let fee = amount
            .checked_mul(fee_bps as i128)
            .map(|n| n / BPS_DENOMINATOR)
            .unwrap_or(0);
        let fee = Self::apply_fee_cap(&env, fee);
        Self::exit_nonreentrant(&env);
        fee
    }

    /// Compute a deterministic, direction-sensitive route identifier for a
    /// `(source, destination)` pair.
    ///
    /// The tag is `keccak256(xdr(source) || xdr(destination))`: a stable
    /// 32-byte digest that depends on the encoded inputs in order. Properties:
    ///
    /// - **Deterministic** ÔÇö the same `(source, destination)` always hashes to
    ///   the same value, so an off-chain backend can recompute it and correlate
    ///   on-chain routes without storing a mapping.
    /// - **Direction-sensitive** ÔÇö `source` is hashed before `destination`, so
    ///   `route_tag(USDC, EURC) != route_tag(EURC, USDC)`. Each leg of a pair
    ///   gets its own identifier.
    ///
    /// Returns the digest as a [`BytesN<32>`].
    pub fn route_tag(env: Env, source: Symbol, destination: Symbol) -> BytesN<32> {
        // Build the pre-image deterministically: the XDR encoding of `source`
        // followed by the XDR encoding of `destination`. Ordering the appends
        // this way is what makes the tag direction-sensitive.
        let mut buf = Bytes::new(&env);
        buf.append(&source.to_xdr(&env));
        buf.append(&destination.to_xdr(&env));
        env.crypto().keccak256(&buf).to_bytes()
    }

    // ------------------------------------------------------------------
    //  Savings data model ÔÇö principal / yield separation
    // ------------------------------------------------------------------

    /// Require the savings module to be initialized. Panics with
    /// [`RouterError::SavingsNotInitialized`] (#21) when the
    /// `SavingsConfig` slot is absent.
    fn require_savings_initialized(env: &Env) -> SavingsConfig {
        env.storage()
            .persistent()
            .get(&DataKey::SavingsConfig)
            .unwrap_or_else(|| panic_with_error!(env, RouterError::SavingsNotInitialized))
    }

    /// Load a user's [`SavingsInfo`], accruing yield first so the returned
    /// snapshot is current. Returns `None` when the user has no account.
    fn load_savings_with_accrual(
        env: &Env,
        config: &SavingsConfig,
        user: &Address,
    ) -> Option<SavingsInfo> {
        let mut info: SavingsInfo = env
            .storage()
            .persistent()
            .get(&DataKey::SavingsAccount(user.clone()))?;
        // Accrue yield up to the current ledger timestamp.
        let now = env.ledger().timestamp();
        if now > info.last_accrued && info.principal > 0 {
            let elapsed = (now - info.last_accrued) as u128;
            // yield = principal * rate * elapsed / (YEAR_SECS * 10_000)
            // Use u128 for the multiplication to avoid overflow, then
            // saturatingly convert back to i128.  principal is bounded
            // well below i128::MAX / MAX_YIELD_RATE_BPS in practice, so
            // the u128 multiplication is safe.
            let increment = (info.principal as u128)
                .saturating_mul(config.yield_rate_bps as u128)
                .saturating_mul(elapsed)
                .saturating_div(YEAR_SECS * BPS_DENOMINATOR as u128);
            let increment = i128::try_from(increment).unwrap_or(i128::MAX);
            info.yield_earned = info.yield_earned.saturating_add(increment);
            info.last_accrued = now;
        }
        Some(info)
    }

    /// Initialize the savings module with an annual yield rate.
    ///
    /// Admin-gated. Idempotent guard: panics with
    /// [`RouterError::SavingsAlreadyInitialized`] (#23) if the savings
    /// config slot already exists, so callers cannot accidentally
    /// overwrite live savings state. Rejects rates above
    /// [`MAX_YIELD_RATE_BPS`] with [`RouterError::YieldRateTooHigh`]
    /// (#24). Emits a `sv_init` event carrying the yield rate.
    pub fn init_savings(env: Env, yield_rate_bps: u32) {
        Self::require_admin(&env);
        if env.storage().persistent().has(&DataKey::SavingsConfig) {
            panic_with_error!(&env, RouterError::SavingsAlreadyInitialized);
        }
        if yield_rate_bps > MAX_YIELD_RATE_BPS {
            panic_with_error!(&env, RouterError::YieldRateTooHigh);
        }
        let config = SavingsConfig {
            yield_rate_bps,
            total_principal: 0,
            total_yield: 0,
            initialized: true,
        };
        env.storage()
            .persistent()
            .set(&DataKey::SavingsConfig, &config);
        env.events()
            .publish((symbol_short!("sv_init"),), yield_rate_bps);
    }

    /// Set the annual yield rate for the savings module.
    ///
    /// Admin-gated. Rejects rates above [`MAX_YIELD_RATE_BPS`] with
    /// [`RouterError::YieldRateTooHigh`] (#24). Requires savings to
    /// already be initialized. Emits a `yield_set` event carrying the
    /// new rate. Changing the rate does not retroactively affect prior
    /// accrual periods; the next `accrue_yield` call for each user uses
    /// the new rate going forward.
    pub fn set_yield_rate(env: Env, yield_rate_bps: u32) {
        Self::require_admin(&env);
        if yield_rate_bps > MAX_YIELD_RATE_BPS {
            panic_with_error!(&env, RouterError::YieldRateTooHigh);
        }
        let mut config = Self::require_savings_initialized(&env);
        config.yield_rate_bps = yield_rate_bps;
        env.storage()
            .persistent()
            .set(&DataKey::SavingsConfig, &config);
        env.events()
            .publish((symbol_short!("yield_set"),), yield_rate_bps);
    }

    /// Read the global savings configuration, or `None` when not
    /// initialized.
    pub fn get_savings_config(env: Env) -> Option<SavingsConfig> {
        env.storage().persistent().get(&DataKey::SavingsConfig)
    }

    /// Read a user's savings snapshot (principal, yield_earned,
    /// last_accrued), with yield brought up to the current ledger
    /// timestamp automatically. Returns `None` when the user has not
    /// deposited.
    ///
    /// This is a **read-only** entrypoint ÔÇö it computes the pending
    /// yield increment ephemerally and returns the up-to-date state
    /// without writing anything to storage. To persist the accrual,
    /// callers must invoke `accrue_yield`.
    pub fn get_savings_info(env: Env, user: Address) -> Option<SavingsInfo> {
        let config = Self::require_savings_initialized(&env);
        Self::load_savings_with_accrual(&env, &config, &user)
    }

    /// Deposit `amount` into the caller's savings account.
    ///
    /// Requires `caller.require_auth()`. The full `amount` is added to
    /// the user's `principal` (never to `yield_earned`), preserving the
    /// separation that the savings data model guarantees. Prior yield is
    /// automatically accrued before the deposit is applied.
    ///
    /// If this is the first deposit for the user a new `SavingsAccount`
    /// slot is created with `last_accrued` set to the current ledger
    /// timestamp. The global `total_principal` is incremented.
    ///
    /// Rejects non-positive amounts with
    /// [`RouterError::AmountMustBePositiveSavings`] (#25). Emits a
    /// `sv_dep` event carrying `(user, amount, new_principal)`.
    pub fn deposit_savings(env: Env, caller: Address, amount: i128) {
        caller.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, RouterError::AmountMustBePositiveSavings);
        }
        let mut config = Self::require_savings_initialized(&env);
        let now = env.ledger().timestamp();

        // Accrue any pending yield before modifying principal.
        let mut info = env
            .storage()
            .persistent()
            .get(&DataKey::SavingsAccount(caller.clone()))
            .unwrap_or(SavingsInfo {
                principal: 0,
                yield_earned: 0,
                last_accrued: now,
            });

        // Accrue yield up to now before depositing new principal.
        if now > info.last_accrued && info.principal > 0 {
            let elapsed = (now - info.last_accrued) as u128;
            let increment = (info.principal as u128)
                .saturating_mul(config.yield_rate_bps as u128)
                .saturating_mul(elapsed)
                .saturating_div(YEAR_SECS * BPS_DENOMINATOR as u128);
            let increment = i128::try_from(increment).unwrap_or(i128::MAX);
            info.yield_earned = info.yield_earned.saturating_add(increment);
            config.total_yield = config.total_yield.saturating_add(increment);
        }

        info.principal = info.principal.saturating_add(amount);
        info.last_accrued = now;
        config.total_principal = config.total_principal.saturating_add(amount);

        env.storage()
            .persistent()
            .set(&DataKey::SavingsAccount(caller.clone()), &info);
        env.storage()
            .persistent()
            .set(&DataKey::SavingsConfig, &config);
        env.events()
            .publish((symbol_short!("sv_dep"),), (caller, amount, info.principal));
    }

    /// Withdraw up to `amount` from the caller's savings balance.
    ///
    /// Requires `caller.require_auth()`. Withdrawals first consume
    /// `yield_earned` before touching `principal`, preserving the data
    /// model's principal-is-sacred invariant. The global totals are
    /// decremented accordingly.
    ///
    /// Rejects non-positive amounts with
    /// [`RouterError::AmountMustBePositiveSavings`] (#25). Panics with
    /// [`RouterError::InsufficientSavingsBalance`] (#22) when the user's
    /// total balance (principal + yield_earned) is less than `amount`.
    /// Emits a `sv_wd` event carrying `(user, amount, remaining_principal,
    /// remaining_yield)`.
    pub fn withdraw_savings(env: Env, caller: Address, amount: i128) {
        caller.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, RouterError::AmountMustBePositiveSavings);
        }
        let mut config = Self::require_savings_initialized(&env);

        // Accrue yield first so the withdrawal sees the current balance.
        let mut info = Self::load_savings_with_accrual(&env, &config, &caller)
            .unwrap_or_else(|| panic_with_error!(&env, RouterError::InsufficientSavingsBalance));

        let total = info.principal.saturating_add(info.yield_earned);
        if amount > total {
            panic_with_error!(&env, RouterError::InsufficientSavingsBalance);
        }

        // Deduct from yield first, then principal.
        let from_yield = info.yield_earned.min(amount);
        let from_principal = amount - from_yield;
        info.yield_earned -= from_yield;
        info.principal -= from_principal;
        config.total_yield = config.total_yield.saturating_sub(from_yield);
        config.total_principal = config.total_principal.saturating_sub(from_principal);

        // Remove the account slot entirely if the user has drained everything.
        if info.principal == 0 && info.yield_earned == 0 {
            env.storage()
                .persistent()
                .remove(&DataKey::SavingsAccount(caller.clone()));
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::SavingsAccount(caller.clone()), &info);
        }
        env.storage()
            .persistent()
            .set(&DataKey::SavingsConfig, &config);
        env.events().publish(
            (symbol_short!("sv_wd"),),
            (caller, amount, info.principal, info.yield_earned),
        );
    }

    /// Persist any pending yield for a specific user.
    ///
    /// Anyone may call this for any user ÔÇö it is a public good to keep
    /// savings state current. Calculates the yield accrued since the
    /// user's `last_accrued` timestamp using the formula:
    ///
    /// ```text
    /// yield_increment = principal * yield_rate_bps * elapsed / (YEAR_SECS * 10_000)
    /// ```
    ///
    /// The increment is added to the user's `yield_earned` and the
    /// global `total_yield`. The user's `last_accrued` is advanced to
    /// the current ledger timestamp. Emits a `sv_acc` event carrying
    /// `(user, yield_increment, new_total_yield)`.
    ///
    /// No-op when the user has no account or `principal == 0` (no yield
    /// can accrue on a zero balance).
    pub fn accrue_yield(env: Env, user: Address) {
        let mut config = Self::require_savings_initialized(&env);
        let now = env.ledger().timestamp();

        let mut info = match env
            .storage()
            .persistent()
            .get::<_, SavingsInfo>(&DataKey::SavingsAccount(user.clone()))
        {
            Some(i) => i,
            None => return, // no account ÔÇö nothing to accrue
        };

        if info.principal == 0 || now <= info.last_accrued {
            return; // nothing to accrue
        }

        let elapsed = (now - info.last_accrued) as u128;
        let increment = (info.principal as u128)
            .saturating_mul(config.yield_rate_bps as u128)
            .saturating_mul(elapsed)
            .saturating_div(YEAR_SECS * BPS_DENOMINATOR as u128);
        let increment = i128::try_from(increment).unwrap_or(i128::MAX);

        info.yield_earned = info.yield_earned.saturating_add(increment);
        info.last_accrued = now;
        config.total_yield = config.total_yield.saturating_add(increment);

        env.storage()
            .persistent()
            .set(&DataKey::SavingsAccount(user.clone()), &info);
        env.storage()
            .persistent()
            .set(&DataKey::SavingsConfig, &config);
        env.events().publish(
            (symbol_short!("sv_acc"),),
            (user, increment, config.total_yield),
        );
    }

    /// Replace the contract's WASM in-place so the router can be patched
    /// without losing pair state. Admin-gated; emits an `upgraded` event
    /// carrying the new hash so indexers and watchers can audit upgrades.
    ///
    /// ## Trade-off: not paused-gated
    ///
    /// An emergency pause should arguably still allow the admin to deploy a
    /// fix. We therefore skip the `ContractPaused` check ÔÇö a paused router
    /// can be upgraded, which is consistent with fixing the bug that caused
    /// the pause. The admin can already unpause, so there is no escalation
    /// path through this exception.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::require_admin(&env);
        env.events()
            .publish((symbol_short!("upgraded"),), &new_wasm_hash);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

/// Test-only mock that re-enters the router from a nested contract call.
///
/// The mock stays minimal on purpose: it exists only to simulate a malicious
/// callback path and trigger the router's reentrancy guard in a realistic
/// nested-call shape.
#[cfg(test)]
#[contract]
pub struct MaliciousReentryMock;

#[cfg(test)]
#[contractimpl]
impl MaliciousReentryMock {
    /// Call back into `compute_route_fee` on the target router.
    ///
    /// The test harness arranges for the router lock to already be held before
    /// this entrypoint runs, so the nested router call exercises the guard as a
    /// callback-style re-entry attempt.
    pub fn reenter(
        env: Env,
        router_id: Address,
        source: Symbol,
        destination: Symbol,
        amount: i128,
    ) {
        let router = StableRouteRouterClient::new(&env, &router_id);
        router.compute_route_fee(&source, &destination, &amount);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Events, Ledger},
        IntoVal,
    };
    use std::any::Any;
    use std::string::{String, ToString};

    /// Register a USDCÔåÆEURC pair with `fee_bps` and unbounded liquidity,
    /// returning a ready client. Shared by the property tests below.
    fn setup_pair_with_fee(env: &Env, fee_bps: u32) -> StableRouteRouterClient<'_> {
        let (client, _admin) = setup_initialized(env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &fee_bps);
        client
    }

    fn panic_message(err: &(dyn Any + Send)) -> Option<String> {
        err.downcast_ref::<String>()
            .cloned()
            .or_else(|| err.downcast_ref::<&str>().map(|s| (*s).to_string()))
    }

    proptest! {
        // Fixed case count keeps CI deterministic and fast.
        #![proptest_config(ProptestConfig { cases: 96, ..ProptestConfig::default() })]

        /// Invariant: the fee never exceeds the routed amount and is never
        /// negative, for any valid fee_bps and amount. `amount * fee_bps`
        /// stays well within i128 (amount < 1e24, fee_bps <= 1000).
        #[test]
        fn prop_fee_within_amount(
            amount in 1i128..1_000_000_000_000_000_000_000_000i128,
            fee_bps in 0u32..=MAX_FEE_BPS,
        ) {
            let env = Env::default();
            let client = setup_pair_with_fee(&env, fee_bps);
            let fee = client.compute_route_fee(
                &symbol_short!("USDC"),
                &symbol_short!("EURC"),
                &amount,
            );
            prop_assert!(fee >= 0);
            prop_assert!(fee <= amount);
        }

        /// Invariant: a zero fee_bps always yields a zero fee.
        #[test]
        fn prop_zero_fee_bps_is_free(
            amount in 1i128..1_000_000_000_000_000_000i128,
        ) {
            let env = Env::default();
            let client = setup_pair_with_fee(&env, 0);
            let fee = client.compute_route_fee(
                &symbol_short!("USDC"),
                &symbol_short!("EURC"),
                &amount,
            );
            prop_assert_eq!(fee, 0);
        }

        /// Invariant: `quote_route` reports the same fee as
        /// `compute_route_fee` for identical config, and fee + net == amount.
        #[test]
        fn prop_quote_matches_compute(
            amount in 1i128..1_000_000_000_000_000_000i128,
            fee_bps in 0u32..=MAX_FEE_BPS,
        ) {
            let env = Env::default();
            let client = setup_pair_with_fee(&env, fee_bps);
            let (quoted_fee, net) = client.quote_route(
                &symbol_short!("USDC"),
                &symbol_short!("EURC"),
                &amount,
            );
            let computed_fee = client.compute_route_fee(
                &symbol_short!("USDC"),
                &symbol_short!("EURC"),
                &amount,
            );
            prop_assert_eq!(quoted_fee, computed_fee);
            prop_assert_eq!(quoted_fee + net, amount);
        }
    }

    /// Deploy the router with `admin` set atomically via the constructor
    /// (`register(StableRouteRouter, (admin,))`) ÔÇö the front-run-safe path.
    fn setup_initialized(env: &Env) -> (StableRouteRouterClient<'_>, Address) {
        let (client, admin, _id) = setup_initialized_with_id(env);
        (client, admin)
    }

    /// Like [`setup_initialized`] but also returns the contract id so tests
    /// can reach into the contract's own storage via `env.as_contract`.
    fn setup_initialized_with_id(env: &Env) -> (StableRouteRouterClient<'_>, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let contract_id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(env, &contract_id);
        (client, admin, contract_id)
    }

    /// Register a router without constructor args so legacy pre-init tests can
    /// assert uninitialized admin-gated entrypoints still fail cleanly.
    fn setup_uninitialized(env: &Env) -> StableRouteRouterClient<'_> {
        env.mock_all_auths();
        let contract_id = env.register(StableRouteRouter, ());
        StableRouteRouterClient::new(env, &contract_id)
    }

    #[test]
    fn test_version() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &contract_id);
        let v = client.version();
        assert_eq!(v, symbol_short!("ROUTER_V2"));
    }

    #[test]
    fn test_route_tag() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &contract_id);

        // Determinism: the same inputs hash to the same tag across calls.
        let tag_a = client.route_tag(&symbol_short!("USDC"), &symbol_short!("EURC"));
        let tag_b = client.route_tag(&symbol_short!("USDC"), &symbol_short!("EURC"));
        assert_eq!(tag_a, tag_b);

        // Direction sensitivity: (src, dst) differs from (dst, src).
        let reversed = client.route_tag(&symbol_short!("EURC"), &symbol_short!("USDC"));
        assert_ne!(tag_a, reversed);

        // Distinct pairs produce distinct tags.
        let other = client.route_tag(&symbol_short!("USDC"), &symbol_short!("XLM"));
        assert_ne!(tag_a, other);
    }

    #[test]
    fn test_init_persists_admin() {
        let env = Env::default();
        let (client, admin) = setup_initialized(&env);
        assert_eq!(client.get_admin(), Some(admin));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_init_rejects_double_init() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let other = Address::generate(&env);
        client.init(&other);
    }

    #[test]
    fn test_register_pair_round_trip() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        assert!(client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("EURC")));
        // Reverse direction is independent.
        assert!(!client.is_pair_registered(&symbol_short!("EURC"), &symbol_short!("USDC")));
    }

    #[test]
    fn test_register_pair_is_idempotent() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        assert!(client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("EURC")));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_register_pair_rejects_identity() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("USDC"));
    }

    #[test]
    fn test_is_pair_registered_defaults_to_false() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        assert!(!client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("XLM")));
    }

    #[test]
    fn test_get_pair_fee_bps_defaults_to_zero() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        assert_eq!(
            client.get_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC")),
            0
        );
    }

    #[test]
    fn test_set_pair_fee_bps_round_trip() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &50u32);
        assert_eq!(
            client.get_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC")),
            50
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_set_pair_fee_bps_rejects_above_max() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &(MAX_FEE_BPS + 1),
        );
    }

    #[test]
    fn test_compute_route_fee_basic() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &50u32);
        // 1_000_000 * 50 / 10_000 = 5_000
        let fee = client.compute_route_fee(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1_000_000_i128,
        );
        assert_eq!(fee, 5_000);
    }

    #[test]
    fn test_compute_route_fee_is_zero_when_fee_unset() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        let fee = client.compute_route_fee(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1_000_000_i128,
        );
        assert_eq!(fee, 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_compute_route_fee_rejects_unregistered_pair() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.compute_route_fee(&symbol_short!("USDC"), &symbol_short!("EURC"), &1_000_i128);
    }

    // --- reentrancy guard ---

    /// The normal success path must RELEASE the reentrancy lock, so two
    /// consecutive `compute_route_fee` calls on the same pair both succeed.
    /// If the lock leaked, the second call would panic with #16.
    #[test]
    fn test_compute_route_fee_releases_lock_for_consecutive_calls() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &50u32);

        let first = client.compute_route_fee(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1_000_000_i128,
        );
        let second = client.compute_route_fee(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1_000_000_i128,
        );

        assert_eq!(first, 5_000);
        assert_eq!(second, 5_000);
        assert_eq!(client.get_total_routes_all_time(), 2);
    }

    /// A malicious nested caller must not be able to re-enter
    /// `compute_route_fee` while the router lock is held.
    #[test]
    fn test_compute_route_fee_rejects_reentry_from_mock_callback() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let router_id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(&env, &router_id);
        let mock_id = env.register(MaliciousReentryMock, ());
        let mock = MaliciousReentryMockClient::new(&env, &mock_id);

        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &50u32);

        env.as_contract(&router_id, || {
            env.storage()
                .persistent()
                .set(&DataKey::ReentrancyLock, &true);
        });

        // The mock now performs the nested router call from a normal contract
        // invocation, matching the callback-driven shape we want to exercise.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            mock.reenter(
                &router_id,
                &symbol_short!("USDC"),
                &symbol_short!("EURC"),
                &1_000_000_i128,
            );
        }));
        let panic = result.expect_err("nested router call should panic");
        let message = panic_message(&*panic).expect("panic payload should be printable");
        assert!(
            message.contains("Error(Contract, #15)"),
            "unexpected panic payload: {message}"
        );

        let lock_after: bool = env.as_contract(&router_id, || {
            env.storage()
                .persistent()
                .get(&DataKey::ReentrancyLock)
                .unwrap_or(false)
        });
        assert!(lock_after);

        env.as_contract(&router_id, || {
            env.storage()
                .persistent()
                .set(&DataKey::ReentrancyLock, &false);
        });
        assert_eq!(
            client.compute_route_fee(
                &symbol_short!("USDC"),
                &symbol_short!("EURC"),
                &1_000_000_i128
            ),
            5_000
        );
    }

    /// A successful route must leave the reentrancy lock cleared so
    /// sequential legitimate calls remain possible.
    #[test]
    fn test_compute_route_fee_clears_reentrancy_lock_after_success() {
        let env = Env::default();
        let (client, _admin, contract_id) = setup_initialized_with_id(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &50u32);

        let first = client.compute_route_fee(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1_000_000_i128,
        );
        assert_eq!(first, 5_000);

        let lock_after_first: bool = env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .get(&DataKey::ReentrancyLock)
                .unwrap_or(false)
        });
        assert!(!lock_after_first);

        let second = client.compute_route_fee(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1_000_000_i128,
        );
        assert_eq!(second, 5_000);
        assert_eq!(client.get_total_routes_all_time(), 2);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_compute_route_fee_rejects_zero_amount() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.compute_route_fee(&symbol_short!("USDC"), &symbol_short!("EURC"), &0i128);
    }

    #[test]
    fn test_schema_version_migration() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        assert_eq!(client.get_schema_version(), 1);
        client.migrate_v1_to_v2();
        assert_eq!(client.get_schema_version(), 2);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #13)")]
    fn test_schema_migration_rejects_second_run() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.migrate_v1_to_v2();
        client.migrate_v1_to_v2();
    }

    #[test]
    fn test_pause_and_unpause_round_trip() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        assert!(!client.is_paused());
        client.pause();
        assert!(client.is_paused());
        client.unpause();
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_register_pair_rejects_when_paused() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.pause();
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
    }

    /// The emergency stop must block route accounting: while paused,
    /// `compute_route_fee` panics with `ContractPaused` (#9) and never
    /// touches the counter / timestamp.
    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_compute_route_fee_rejects_when_paused() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &50u32);
        client.pause();
        client.compute_route_fee(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1_000_000_i128,
        );
    }

    /// Routing resumes cleanly after an unpause, and no route was recorded
    /// during the paused window.
    #[test]
    fn test_compute_route_fee_resumes_after_unpause() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &50u32);
        client.pause();
        client.unpause();
        let fee = client.compute_route_fee(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1_000_000_i128,
        );
        assert_eq!(fee, 5_000);
        assert_eq!(client.get_total_routes_all_time(), 1);
    }

    /// Read-only quotes stay available while paused (documented policy:
    /// block state-mutating routes, keep quotes open for planning).
    #[test]
    fn test_quote_route_allowed_while_paused() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &100u32);
        client.pause();
        assert_eq!(
            client.quote_route(&symbol_short!("USDC"), &symbol_short!("EURC"), &1_000i128),
            (10, 990)
        );
    }

    #[test]
    fn test_admin_transfer_flow() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let next_admin = Address::generate(&env);
        client.propose_admin_transfer(&next_admin);
        assert_eq!(client.get_pending_admin(), Some(next_admin.clone()));
        client.accept_admin_transfer(&next_admin);
        assert_eq!(client.get_admin(), Some(next_admin));
        assert_eq!(client.get_pending_admin(), None);
    }

    #[test]
    fn test_cancel_admin_transfer_clears_pending_admin() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let next_admin = Address::generate(&env);
        client.propose_admin_transfer(&next_admin);
        client.cancel_admin_transfer();
        assert_eq!(client.get_pending_admin(), None);
        assert_eq!(client.get_pending_admin_eta(), None);
    }

    // --- #21: governance timelock ---

    /// Timelock defaults to 0 (instant handover) when unset.
    #[test]
    fn test_timelock_defaults_to_zero() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        assert_eq!(client.get_timelock(), 0);
    }

    /// With a delay set, accepting the handover before the eta is rejected
    /// with TimelockNotElapsed (#14).
    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn test_timelock_blocks_early_accept() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (client, _admin) = setup_initialized(&env);
        client.set_timelock(&100);
        let next_admin = Address::generate(&env);
        client.propose_admin_transfer(&next_admin);
        assert_eq!(client.get_pending_admin_eta(), Some(1_100));
        client.accept_admin_transfer(&next_admin); // still at t=1_000
    }

    /// After the delay elapses, the handover executes normally.
    #[test]
    fn test_timelock_allows_accept_after_delay() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (client, _admin) = setup_initialized(&env);
        client.set_timelock(&100);
        let next_admin = Address::generate(&env);
        client.propose_admin_transfer(&next_admin);
        env.ledger().set_timestamp(1_100);
        client.accept_admin_transfer(&next_admin);
        assert_eq!(client.get_admin(), Some(next_admin));
        assert_eq!(client.get_pending_admin_eta(), None);
    }

    /// Cancelling a queued transfer clears both the pending admin and eta.
    #[test]
    fn test_timelock_cancel_clears_queue() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (client, _admin) = setup_initialized(&env);
        client.set_timelock(&100);
        let next_admin = Address::generate(&env);
        client.propose_admin_transfer(&next_admin);
        client.cancel_admin_transfer();
        assert_eq!(client.get_pending_admin(), None);
        assert_eq!(client.get_pending_admin_eta(), None);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_accept_admin_transfer_rejects_missing_pending_admin() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let caller = Address::generate(&env);
        client.accept_admin_transfer(&caller);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_accept_admin_transfer_rejects_wrong_pending_admin() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let pending = Address::generate(&env);
        let caller = Address::generate(&env);
        client.propose_admin_transfer(&pending);
        client.accept_admin_transfer(&caller);
    }

    // --- force_admin_transfer tests ---

    #[test]
    fn test_force_admin_transfer_success() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let next_admin = Address::generate(&env);
        client.propose_admin_transfer(&next_admin);
        client.force_admin_transfer(&next_admin);
        assert_eq!(client.get_admin(), Some(next_admin));
        assert_eq!(client.get_pending_admin(), None);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_force_admin_transfer_rejects_missing_pending_admin() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let next_admin = Address::generate(&env);
        client.force_admin_transfer(&next_admin);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_force_admin_transfer_rejects_wrong_pending_admin() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let pending = Address::generate(&env);
        let wrong = Address::generate(&env);
        client.propose_admin_transfer(&pending);
        client.force_admin_transfer(&wrong);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn test_force_admin_transfer_blocks_early_force() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (client, _admin) = setup_initialized(&env);
        client.set_timelock(&100);
        let next_admin = Address::generate(&env);
        client.propose_admin_transfer(&next_admin);
        client.force_admin_transfer(&next_admin);
    }

    #[test]
    fn test_force_admin_transfer_allows_after_timelock() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (client, _admin) = setup_initialized(&env);
        client.set_timelock(&100);
        let next_admin = Address::generate(&env);
        client.propose_admin_transfer(&next_admin);
        env.ledger().set_timestamp(1_100);
        client.force_admin_transfer(&next_admin);
        assert_eq!(client.get_admin(), Some(next_admin));
    }

    #[test]
    fn test_force_admin_transfer_emits_executed_event() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let next_admin = Address::generate(&env);
        client.propose_admin_transfer(&next_admin);
        client.force_admin_transfer(&next_admin);

        let executed_payloads = event_payloads(&env, symbol_short!("executed"));
        assert_eq!(executed_payloads.len(), 1);
        let event_admin: Address =
            soroban_sdk::TryFromVal::try_from_val(&env, &executed_payloads[0])
                .expect("executed event data decodes to admin address");
        assert_eq!(event_admin, next_admin);
    }

    #[test]
    fn test_fee_recipient_round_trip() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        assert_eq!(client.get_fee_recipient(), None);
        let recipient = Address::generate(&env);
        client.set_fee_recipient(&recipient);
        assert_eq!(client.get_fee_recipient(), Some(recipient));
    }

    #[test]
    fn test_unregister_pair_removes_registration() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.unregister_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        assert!(!client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("EURC")));
    }

    #[test]
    fn test_pair_lifecycle_events_have_exact_payloads_and_counts() {
        let env = Env::default();
        let (client, admin) = setup_initialized(&env);
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");

        let init_payloads = event_payloads(&env, symbol_short!("init"));
        assert_eq!(init_payloads.len(), 1, "constructor emits one init event");
        let init_admin: Address = soroban_sdk::TryFromVal::try_from_val(&env, &init_payloads[0])
            .expect("init event data decodes to admin address");
        assert_eq!(init_admin, admin);

        client.register_pair(&src, &dest);
        let pair_reg_payloads = event_payloads(&env, symbol_short!("pair_reg"));
        assert_eq!(
            pair_reg_payloads.len(),
            1,
            "register_pair emits one pair_reg event"
        );
        let pair_reg: (Symbol, Symbol) =
            soroban_sdk::TryFromVal::try_from_val(&env, &pair_reg_payloads[0])
                .expect("pair_reg event data decodes to pair tuple");
        assert_eq!(pair_reg, (src.clone(), dest.clone()));

        client.set_pair_fee_bps(&src, &dest, &25u32);
        let fee_set_payloads = event_payloads(&env, symbol_short!("fee_set"));
        assert_eq!(
            fee_set_payloads.len(),
            1,
            "set_pair_fee_bps emits one fee_set event"
        );
        let fee_set: (Symbol, Symbol, u32) =
            soroban_sdk::TryFromVal::try_from_val(&env, &fee_set_payloads[0])
                .expect("fee_set event data decodes to pair and fee");
        assert_eq!(fee_set, (src.clone(), dest.clone(), 25u32));

        client.set_pair_liquidity(&admin, &src, &dest, &1_000i128);
        let liq_set_payloads = event_payloads(&env, symbol_short!("liq_set"));
        assert_eq!(
            liq_set_payloads.len(),
            1,
            "set_pair_liquidity emits one liq_set event"
        );
        let liq_set: (Symbol, Symbol, i128) =
            soroban_sdk::TryFromVal::try_from_val(&env, &liq_set_payloads[0])
                .expect("liq_set event data decodes to pair and liquidity");
        assert_eq!(liq_set, (src.clone(), dest.clone(), 1_000i128));

        client.unregister_pair(&src, &dest);
        let unreg_payloads = event_payloads(&env, symbol_short!("unreg"));
        assert_eq!(
            unreg_payloads.len(),
            1,
            "unregister_pair emits one unreg event"
        );
        let unreg: (Symbol, Symbol) =
            soroban_sdk::TryFromVal::try_from_val(&env, &unreg_payloads[0])
                .expect("unreg event data decodes to pair tuple");
        assert_eq!(unreg, (src, dest));
    }

    #[test]
    fn test_unregister_never_registered_pair_is_clean_noop_with_event() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");

        assert!(!client.is_pair_registered(&src, &dest));
        client.unregister_pair(&src, &dest);

        let unreg_payloads = event_payloads(&env, symbol_short!("unreg"));
        assert_eq!(
            unreg_payloads.len(),
            1,
            "no-op unregister still documents one lifecycle event"
        );
        let unreg: (Symbol, Symbol) =
            soroban_sdk::TryFromVal::try_from_val(&env, &unreg_payloads[0])
                .expect("unreg event data decodes to pair tuple");
        assert_eq!(unreg, (src, dest));
        assert!(!client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("EURC")));
    }

    #[test]
    fn test_reregister_after_unregister_restores_pair_and_preserves_fee() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");

        client.register_pair(&src, &dest);
        assert_eq!(
            event_payloads(&env, symbol_short!("pair_reg")).len(),
            1,
            "initial register should emit one pair_reg event"
        );
        client.set_pair_fee_bps(&src, &dest, &42u32);
        client.unregister_pair(&src, &dest);
        assert_eq!(
            event_payloads(&env, symbol_short!("unreg")).len(),
            1,
            "single unregister should emit one unreg event"
        );

        assert!(!client.is_pair_registered(&src, &dest));
        // Config slots (fee, min, max, liquidity, cooldown) are cleared
        // by `unregister_pair` ÔåÆ `clear_pair_config`, so the fee resets
        // to the default of 0.
        assert_eq!(client.get_pair_fee_bps(&src, &dest), 0);

        client.register_pair(&src, &dest);
        assert_eq!(
            event_payloads(&env, symbol_short!("pair_reg")).len(),
            1,
            "re-register should emit one pair_reg event"
        );

        assert!(client.is_pair_registered(&src, &dest));
        // After re-register the fee is still the default (0) because
        // config was cleared on unregister.
        assert_eq!(client.get_pair_fee_bps(&src, &dest), 0);
    }

    /// Documents the current, unchanged behavior: `unregister_pair` alone
    /// leaves `PairRouteCount`, `PairVolume`, and `PairLastRouteAt` intact,
    /// so a straight unregister + re-register cycle inherits prior metrics.
    #[test]
    fn test_unregister_then_reregister_preserves_metrics_by_default() {
        let env = Env::default();
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");
        let client = setup_routable_pair(&env, &src, &dest, 50u32);

        env.ledger().set_timestamp(777);
        client.compute_route_fee(&src, &dest, &1_000_i128);

        assert_eq!(client.get_pair_route_count(&src, &dest), 1);
        assert_eq!(client.get_pair_volume(&src, &dest), 1_000);
        assert_eq!(client.get_pair_last_route_at(&src, &dest), Some(777));

        client.unregister_pair(&src, &dest);
        client.register_pair(&src, &dest);

        assert!(client.is_pair_registered(&src, &dest));
        assert_eq!(
            client.get_pair_route_count(&src, &dest),
            1,
            "unregister_pair must not clear PairRouteCount"
        );
        assert_eq!(
            client.get_pair_volume(&src, &dest),
            1_000,
            "unregister_pair must not clear PairVolume"
        );
        assert_eq!(
            client.get_pair_last_route_at(&src, &dest),
            Some(777),
            "unregister_pair must not clear PairLastRouteAt"
        );
    }

    /// `purge_pair_metrics` is the explicit, opt-in reset: it clears all
    /// three metrics slots and emits a `pair_mrst` event with the pair.
    #[test]
    fn test_purge_pair_metrics_resets_counters_and_emits_event() {
        let env = Env::default();
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");
        let client = setup_routable_pair(&env, &src, &dest, 50u32);

        env.ledger().set_timestamp(999);
        client.compute_route_fee(&src, &dest, &2_000_i128);

        assert_eq!(client.get_pair_route_count(&src, &dest), 1);
        assert_eq!(client.get_pair_volume(&src, &dest), 2_000);
        assert_eq!(client.get_pair_last_route_at(&src, &dest), Some(999));

        client.purge_pair_metrics(&src, &dest);

        // Check the emitted event immediately after the triggering call,
        // before any further client invocation can roll the host event
        // buffer over to a later call's events.
        let payloads = event_payloads(&env, symbol_short!("pair_mrst"));
        assert_eq!(
            payloads.len(),
            1,
            "purge_pair_metrics emits exactly one pair_mrst event"
        );
        let decoded: (Symbol, Symbol) = soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
            .expect("pair_mrst event data decodes to pair tuple");
        assert_eq!(decoded, (src.clone(), dest.clone()));

        assert_eq!(client.get_pair_route_count(&src, &dest), 0);
        assert_eq!(client.get_pair_volume(&src, &dest), 0);
        assert_eq!(client.get_pair_last_route_at(&src, &dest), None);
    }

    /// `purge_pair_metrics` does not disturb registration or live config ÔÇö
    /// only the three metrics slots.
    #[test]
    fn test_purge_pair_metrics_does_not_touch_registration_or_config() {
        let env = Env::default();
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");
        let client = setup_routable_pair(&env, &src, &dest, 50u32);
        client.set_pair_min_amount(&src, &dest, &10i128);
        client.set_pair_max_amount(&src, &dest, &1_000i128);

        client.compute_route_fee(&src, &dest, &500_i128);
        client.purge_pair_metrics(&src, &dest);

        assert!(client.is_pair_registered(&src, &dest));
        assert_eq!(client.get_pair_fee_bps(&src, &dest), 50);
        assert_eq!(client.get_pair_min_amount(&src, &dest), 10);
        assert_eq!(client.get_pair_max_amount(&src, &dest), 1_000);
    }

    /// `purge_pair_metrics` is admin-gated like every other mutating
    /// entrypoint: a non-admin caller's `require_auth()` must fail.
    #[test]
    #[should_panic]
    fn test_purge_pair_metrics_rejects_non_admin() {
        let env = Env::default();
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");
        let stranger = Address::generate(&env);
        let client = setup_routable_pair(&env, &src, &dest, 50u32);
        client.compute_route_fee(&src, &dest, &500_i128);

        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &stranger,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &client.address,
                fn_name: "purge_pair_metrics",
                args: (src.clone(), dest.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.purge_pair_metrics(&src, &dest);
    }

    #[test]
    fn test_pair_limits_liquidity_and_info_round_trip() {
        let env = Env::default();
        let (client, admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        assert!(!client.is_pair_active(&symbol_short!("USDC"), &symbol_short!("EURC")));

        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &25u32);
        client.set_pair_min_amount(&symbol_short!("USDC"), &symbol_short!("EURC"), &10i128);
        client.set_pair_max_amount(&symbol_short!("USDC"), &symbol_short!("EURC"), &1_000i128);
        client.set_pair_liquidity(
            &admin,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &500i128,
        );

        assert_eq!(
            client.get_pair_min_amount(&symbol_short!("USDC"), &symbol_short!("EURC")),
            10
        );
        assert_eq!(
            client.get_pair_max_amount(&symbol_short!("USDC"), &symbol_short!("EURC")),
            1_000
        );
        assert_eq!(
            client.get_pair_liquidity(&symbol_short!("USDC"), &symbol_short!("EURC")),
            500
        );
        assert!(client.is_pair_active(&symbol_short!("USDC"), &symbol_short!("EURC")));

        let info = client.get_pair_info(&symbol_short!("USDC"), &symbol_short!("EURC"));
        assert_eq!(
            info,
            PairInfo {
                registered: true,
                fee_bps: 25,
                min_amount: 10,
                max_amount: 1_000,
                liquidity: 500,
                last_route_at: 0,
            }
        );
    }

    #[test]
    fn test_quote_route_and_compute_route_update_counters() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &100u32);

        assert_eq!(
            client.quote_route(&symbol_short!("USDC"), &symbol_short!("EURC"), &1_000i128),
            (10, 990)
        );
        assert_eq!(client.get_total_routes_all_time(), 0);

        assert_eq!(
            client.compute_route_fee(&symbol_short!("USDC"), &symbol_short!("EURC"), &1_000i128),
            10
        );
        assert_eq!(client.get_total_routes_all_time(), 1);
        assert_eq!(
            client.get_pair_last_route_at(&symbol_short!("USDC"), &symbol_short!("EURC")),
            Some(0)
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_quote_route_rejects_zero_amount() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.quote_route(&symbol_short!("USDC"), &symbol_short!("EURC"), &0i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_quote_route_rejects_unregistered_pair() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.quote_route(&symbol_short!("USDC"), &symbol_short!("EURC"), &1_000i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn test_compute_route_fee_rejects_below_minimum() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_min_amount(&symbol_short!("USDC"), &symbol_short!("EURC"), &10i128);
        client.compute_route_fee(&symbol_short!("USDC"), &symbol_short!("EURC"), &9i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn test_compute_route_fee_rejects_above_maximum() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_max_amount(&symbol_short!("USDC"), &symbol_short!("EURC"), &10i128);
        client.compute_route_fee(&symbol_short!("USDC"), &symbol_short!("EURC"), &11i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn test_compute_route_fee_rejects_insufficient_liquidity() {
        let env = Env::default();
        let (client, admin) = setup_initialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_liquidity(
            &admin,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &10i128,
        );
        client.compute_route_fee(&symbol_short!("USDC"), &symbol_short!("EURC"), &11i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_set_pair_liquidity_rejects_negative_value() {
        let env = Env::default();
        let (client, admin) = setup_initialized(&env);
        client.set_pair_liquidity(
            &admin,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &-1i128,
        );
    }

    // --- #22: scoped oracle role ---

    /// The oracle (a non-admin) can update pair liquidity.
    #[test]
    fn test_oracle_can_update_liquidity() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let oracle = Address::generate(&env);
        client.set_oracle(&oracle);
        assert_eq!(client.get_oracle(), Some(oracle.clone()));
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_liquidity(
            &oracle,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &777i128,
        );
        assert_eq!(
            client.get_pair_liquidity(&symbol_short!("USDC"), &symbol_short!("EURC")),
            777
        );
    }

    /// Admin retains the ability to update liquidity directly.
    #[test]
    fn test_admin_can_still_update_liquidity() {
        let env = Env::default();
        let (client, admin) = setup_initialized(&env);
        let oracle = Address::generate(&env);
        client.set_oracle(&oracle);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_liquidity(
            &admin,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &10i128,
        );
        assert_eq!(
            client.get_pair_liquidity(&symbol_short!("USDC"), &symbol_short!("EURC")),
            10
        );
    }

    /// A caller that is neither admin nor oracle is rejected with
    /// NotAuthorized (#16).
    #[test]
    #[should_panic(expected = "Error(Contract, #16)")]
    fn test_random_caller_cannot_update_liquidity() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let stranger = Address::generate(&env);
        client.set_pair_liquidity(
            &stranger,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1i128,
        );
    }

    /// The oracle role is strictly scoped: the oracle cannot set the
    /// oracle (an admin-only governance action).
    #[test]
    #[should_panic]
    fn test_oracle_cannot_call_admin_entrypoint() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        env.mock_all_auths();
        let contract_id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(&env, &contract_id);
        client.set_oracle(&oracle);
        // Oracle attempts an admin-only action (pause). Authorize only the
        // oracle so admin.require_auth() must fail.
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &oracle,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.pause();
    }

    // --- oracle revocation (remove_oracle) ---

    /// End-to-end revocation flow: the oracle can update liquidity while
    /// configured, and is fully locked out after `remove_oracle`.
    #[test]
    fn test_oracle_can_update_before_removal_but_not_after() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let oracle = Address::generate(&env);
        client.set_oracle(&oracle);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));

        // Before removal the oracle drives the liquidity feed.
        client.set_pair_liquidity(
            &oracle,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &500i128,
        );
        assert_eq!(
            client.get_pair_liquidity(&symbol_short!("USDC"), &symbol_short!("EURC")),
            500
        );

        client.remove_oracle();
        assert_eq!(client.get_oracle(), None);

        // After removal the same key is rejected with NotAuthorized (#15).
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.set_pair_liquidity(
                &oracle,
                &symbol_short!("USDC"),
                &symbol_short!("EURC"),
                &999i128,
            )
        }));
        assert!(err.is_err());
        // The blocked call left the last accepted value untouched.
        assert_eq!(
            client.get_pair_liquidity(&symbol_short!("USDC"), &symbol_short!("EURC")),
            500
        );
    }

    /// A revoked oracle is rejected with exactly NotAuthorized (#15) ÔÇö
    /// the same code any other stranger gets.
    #[test]
    #[should_panic(expected = "Error(Contract, #16)")]
    fn test_removed_oracle_rejected_with_not_authorized() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let oracle = Address::generate(&env);
        client.set_oracle(&oracle);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.remove_oracle();
        client.set_pair_liquidity(
            &oracle,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1i128,
        );
    }

    /// The admin keeps the liquidity feed after the oracle is revoked:
    /// the dual-auth check degrades to admin-only when the slot is absent.
    #[test]
    fn test_admin_can_still_update_liquidity_after_removal() {
        let env = Env::default();
        let (client, admin) = setup_initialized(&env);
        let oracle = Address::generate(&env);
        client.set_oracle(&oracle);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.remove_oracle();
        client.set_pair_liquidity(
            &admin,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &42i128,
        );
        assert_eq!(
            client.get_pair_liquidity(&symbol_short!("USDC"), &symbol_short!("EURC")),
            42
        );
    }

    /// Removal is idempotent: removing when a previous removal (or nothing)
    /// left the slot empty is a clean no-op and the getter stays None.
    #[test]
    fn test_remove_oracle_is_idempotent() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        // Remove when never set ÔÇö clean no-op.
        assert_eq!(client.get_oracle(), None);
        client.remove_oracle();
        assert_eq!(client.get_oracle(), None);
        // Set, remove, then remove again ÔÇö second removal is also a no-op.
        let oracle = Address::generate(&env);
        client.set_oracle(&oracle);
        client.remove_oracle();
        client.remove_oracle();
        assert_eq!(client.get_oracle(), None);
    }

    /// `remove_oracle` emits one `orac_rm` event per call, carrying the
    /// previously configured oracle (`None` on a no-op removal).
    #[test]
    fn test_remove_oracle_emits_orac_rm_event() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let oracle = Address::generate(&env);
        client.set_oracle(&oracle);
        client.remove_oracle();
        let payloads = event_payloads(&env, symbol_short!("orac_rm"));
        assert_eq!(payloads.len(), 1, "remove_oracle emits one orac_rm event");
        let removed: Option<Address> = soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
            .expect("orac_rm event data decodes to Option<Address>");
        assert_eq!(removed, Some(oracle));
    }

    /// A no-op removal still emits `orac_rm`, with `None` as the payload,
    /// so indexers observe every revocation attempt.
    #[test]
    fn test_remove_oracle_noop_emits_event_with_none() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.remove_oracle();
        let payloads = event_payloads(&env, symbol_short!("orac_rm"));
        assert_eq!(payloads.len(), 1);
        let removed: Option<Address> = soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
            .expect("orac_rm event data decodes to Option<Address>");
        assert_eq!(removed, None);
    }

    /// After removal the oracle can be set again (rotation to a fresh key
    /// once the incident is resolved).
    #[test]
    fn test_oracle_can_be_reconfigured_after_removal() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let compromised = Address::generate(&env);
        client.set_oracle(&compromised);
        client.remove_oracle();
        let fresh = Address::generate(&env);
        client.set_oracle(&fresh);
        assert_eq!(client.get_oracle(), Some(fresh.clone()));
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.set_pair_liquidity(
            &fresh,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &7i128,
        );
        assert_eq!(
            client.get_pair_liquidity(&symbol_short!("USDC"), &symbol_short!("EURC")),
            7
        );
    }

    /// `remove_oracle` is admin-gated: a caller without the admin's auth
    /// is rejected, so a compromised oracle cannot un-revoke itself or
    /// grief the admin by clearing the slot.
    #[test]
    #[should_panic]
    fn test_remove_oracle_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        env.mock_all_auths();
        let contract_id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(&env, &contract_id);
        client.set_oracle(&oracle);
        // Authorize only the oracle so admin.require_auth() must fail.
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &oracle,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "remove_oracle",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.remove_oracle();
    }

    /// Missing-admin path reuses NotInitialized (#2), like every other
    /// admin-gated entrypoint.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_remove_oracle_panics_when_uninitialized() {
        let env = Env::default();
        let (client, _admin, contract_id) = setup_initialized_with_id(&env);
        env.as_contract(&contract_id, || {
            env.storage().persistent().remove(&DataKey::Admin);
        });
        client.remove_oracle();
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_set_pair_max_amount_rejects_zero() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.set_pair_max_amount(&symbol_short!("USDC"), &symbol_short!("EURC"), &0i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_set_pair_min_amount_rejects_negative_value() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        client.set_pair_min_amount(&symbol_short!("USDC"), &symbol_short!("EURC"), &-1i128);
    }

    // --- compute_route_fee side-effect tests ---

    /// Register `(source, destination)` and set its fee so that
    /// `compute_route_fee` clears every guard (pair registered, fee set,
    /// min/max unset ÔåÆ permissive, liquidity unset ÔåÆ defaults to i128::MAX).
    /// Returns the live client for chaining assertions.
    fn setup_routable_pair<'a>(
        env: &'a Env,
        source: &Symbol,
        destination: &Symbol,
        fee_bps: u32,
    ) -> StableRouteRouterClient<'a> {
        let (client, _admin) = setup_initialized(env);
        client.register_pair(source, destination);
        client.set_pair_fee_bps(source, destination, &fee_bps);
        client
    }

    /// Scan the test-host's current contract events and return the decoded
    /// `data` payloads of every event whose single topic matches `topic`.
    pub(crate) fn event_payloads(env: &Env, topic: Symbol) -> std::vec::Vec<soroban_sdk::Val> {
        use soroban_sdk::{
            xdr::{ContractEventBody, ScVal},
            TryFromVal, Val,
        };
        env.events()
            .all()
            .events()
            .iter()
            .filter_map(|event| {
                let ContractEventBody::V0(body) = &event.body;
                let topics = body.topics.as_slice();
                if topics.len() != 1 {
                    return None;
                }
                let ScVal::Symbol(raw_topic) = &topics[0] else {
                    return None;
                };
                let actual_topic =
                    Symbol::try_from_val(env, raw_topic).expect("event topic decodes to Symbol");
                if actual_topic == topic {
                    Some(Val::try_from_val(env, &body.data).expect("event data decodes to Val"))
                } else {
                    None
                }
            })
            .collect()
    }

    fn route_event_payloads(env: &Env) -> std::vec::Vec<soroban_sdk::Val> {
        event_payloads(env, symbol_short!("route"))
    }

    #[test]
    fn test_compute_route_fee_emits_route_event_with_payload() {
        let env = Env::default();
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");
        let amount = 1_000_000_i128;
        let client = setup_routable_pair(&env, &src, &dest, 50u32);

        client.compute_route_fee(&src, &dest, &amount);

        // Exactly one `route` event, carrying (source, destination, amount).
        let payloads = route_event_payloads(&env);
        assert_eq!(payloads.len(), 1, "exactly one route event expected");
        let decoded: (Symbol, Symbol, i128) =
            soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
                .expect("route data decodes to (Symbol, Symbol, i128)");
        assert_eq!(decoded, (src, dest, amount));
    }

    #[test]
    fn test_compute_route_fee_stamps_pair_last_route_at() {
        let env = Env::default();
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");
        let client = setup_routable_pair(&env, &src, &dest, 50u32);

        // None before any route touches the pair.
        assert_eq!(client.get_pair_last_route_at(&src, &dest), None);

        env.ledger().set_timestamp(12345);
        client.compute_route_fee(&src, &dest, &1_000_i128);

        assert_eq!(client.get_pair_last_route_at(&src, &dest), Some(12345));
    }

    #[test]
    fn test_compute_route_fee_counter_is_global_across_pairs() {
        let env = Env::default();
        // Pair A.
        let a_src = symbol_short!("USDC");
        let a_dest = symbol_short!("EURC");
        let client = setup_routable_pair(&env, &a_src, &a_dest, 50u32);
        // Pair B (different pair) registered on the same contract instance.
        let b_src = symbol_short!("XLM");
        let b_dest = symbol_short!("USDC");
        client.register_pair(&b_src, &b_dest);
        client.set_pair_fee_bps(&b_src, &b_dest, &50u32);

        assert_eq!(client.get_total_routes_all_time(), 0);
        client.compute_route_fee(&a_src, &a_dest, &1_000_i128);
        assert_eq!(client.get_total_routes_all_time(), 1);
        client.compute_route_fee(&b_src, &b_dest, &1_000_i128);
        // The lifetime counter is protocol-wide, not per-pair.
        assert_eq!(client.get_total_routes_all_time(), 2);
    }

    #[test]
    fn test_quote_route_does_not_mutate_counter_or_emit_route_event() {
        let env = Env::default();
        let src = symbol_short!("USDC");
        let dest = symbol_short!("EURC");
        let client = setup_routable_pair(&env, &src, &dest, 100u32);

        let routes_before = client.get_total_routes_all_time();
        let route_events_before = route_event_payloads(&env).len();

        let (fee, net) = client.quote_route(&src, &dest, &1_000_i128);
        assert_eq!((fee, net), (10, 990));

        // quote_route is read-only: counter unchanged, no new `route` event.
        assert_eq!(client.get_total_routes_all_time(), routes_before);
        assert_eq!(route_event_payloads(&env).len(), route_events_before);
    }

    // --- require_admin helper contract tests ---

    /// After the refactor, every admin-gated entrypoint must still reject a
    /// non-admin caller. We test `pause` as a representative; the helper is
    /// shared, so this covers all entrypoints structurally.
    #[test]
    #[should_panic]
    fn test_require_admin_rejects_unauthorized_caller() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        // Deploy with the real admin set atomically by the constructor.
        env.mock_all_auths();
        let contract_id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(&env, &contract_id);
        // Now call pause as the attacker ÔÇö only the attacker is authorized,
        // so admin.require_auth() inside pause must fail.
        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &attacker,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "pause",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.pause(); // must panic: admin.require_auth() fails for attacker
    }

    // --- #20: init front-running hardening ---

    /// Deploy must be observable from the raw event buffer: a fresh
    /// `register(StableRouteRouter, (admin,))` should emit exactly one
    /// `init` event carrying the constructor's admin, and the admin must be
    /// readable immediately without any legacy `init` call.
    #[test]
    fn test_constructor_emits_single_init_event_with_admin_payload() {
        use soroban_sdk::{
            xdr::{ContractEventBody, ScVal},
            TryFromVal,
        };

        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(&env, &contract_id);

        let all_events = env.events().all();
        let events = all_events.events();
        assert_eq!(events.len(), 1, "constructor emits exactly one event");

        let ContractEventBody::V0(body) = &events[0].body;
        let topics = body.topics.as_slice();
        assert_eq!(topics.len(), 1, "init event has a single topic");

        let ScVal::Symbol(raw_topic) = &topics[0] else {
            panic!("constructor event topic decodes to a symbol");
        };
        let topic = Symbol::try_from_val(&env, raw_topic)
            .expect("constructor event topic decodes to Symbol");
        assert_eq!(topic, symbol_short!("init"));

        let init_admin: Address =
            TryFromVal::try_from_val(&env, &body.data).expect("init event data decodes to admin");
        assert_eq!(init_admin, admin);
        assert_eq!(client.get_admin(), Some(admin));
    }

    /// Even the original constructor admin cannot re-run legacy `init`
    /// after deploy; the constructor/init split is permanent and `init`
    /// must always preserve `AlreadyInitialized` (#1).
    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_post_deploy_init_rejects_original_admin() {
        let env = Env::default();
        let (client, admin) = setup_initialized(&env);
        client.init(&admin);
    }

    /// Any other address is equally unable to seize the router with legacy
    /// `init`; once deployed, admin control can only change through the
    /// governed transfer flow.
    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_post_deploy_init_rejects_different_address() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        let attacker = Address::generate(&env);
        client.init(&attacker);
    }

    // --- version surface stability ---

    /// `version()` is the fixed contract identity tag and must be entirely
    /// independent of `get_schema_version()`: migrating the storage schema
    /// from v1 to v2 advances the schema number but never the version tag.
    #[test]
    fn test_version_is_independent_of_schema_version() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        // Version tag and schema number start at known, distinct values.
        assert_eq!(client.version(), symbol_short!("ROUTER_V2"));
        assert_eq!(client.get_schema_version(), 1);

        client.migrate_v1_to_v2();

        // Schema advanced 1 -> 2, but the version tag is unchanged.
        assert_eq!(client.get_schema_version(), 2);
        assert_eq!(client.version(), symbol_short!("ROUTER_V2"));
    }

    /// The constructor requires an admin argument, so tests cannot create the
    /// old deployed-but-uninitialized state with zero constructor args.
    #[test]
    #[should_panic]
    fn test_constructor_rejects_missing_admin_arg() {
        let env = Env::default();
        let _client = setup_uninitialized(&env);
    }
}

/// Issue #14 ÔÇö pause/unpause gating across state-changing entrypoints.
/// Covers the default-false flag, event emission, the `ContractPaused` (#9)
/// rejection on gated entrypoints, recovery after unpause, and idempotency.
#[cfg(test)]
mod test_i14_pause_gating {
    use super::*;
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Events},
    };

    /// Deploy a router with all auths mocked.
    fn setup(env: &Env) -> StableRouteRouterClient<'_> {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(env, &id);
        client
    }

    #[test]
    fn test_is_paused_defaults_false_and_toggles() {
        let env = Env::default();
        let client = setup(&env);
        assert!(!client.is_paused());
        client.pause();
        assert!(client.is_paused());
        client.unpause();
        assert!(!client.is_paused());
    }

    #[test]
    fn test_pause_emits_event() {
        let env = Env::default();
        let client = setup(&env);
        client.pause();
        // pause() publishes a `paused` event; assert one was emitted.
        assert!(!env.events().all().events().is_empty());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_register_pair_rejected_while_paused() {
        let env = Env::default();
        let client = setup(&env);
        client.pause();
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_set_pair_fee_bps_rejected_while_paused() {
        let env = Env::default();
        let client = setup(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        client.pause();
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &10u32);
    }

    #[test]
    fn test_gated_entrypoint_succeeds_after_unpause() {
        let env = Env::default();
        let client = setup(&env);
        client.pause();
        client.unpause();
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        assert!(client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("EURC")));
    }

    #[test]
    fn test_double_pause_and_double_unpause_idempotent() {
        let env = Env::default();
        let client = setup(&env);
        client.pause();
        client.pause();
        assert!(client.is_paused());
        client.unpause();
        client.unpause();
        assert!(!client.is_paused());
    }
}

/// Issue #15 ÔÇö min/max amount and liquidity guards in `compute_route_fee`.
/// Covers at-bound acceptance, below-min (#10), above-max (#11), and
/// over-liquidity (#12) rejection, the unset sentinels, and negative
/// liquidity rejection (#6).
#[cfg(test)]
mod test_i15_bounds_liquidity {
    use super::*;
    use soroban_sdk::{symbol_short, testutils::Address as _};

    /// Register a pair with all auths mocked; returns the client and pair ids.
    fn setup_pair(env: &Env) -> (StableRouteRouterClient<'_>, Address, Symbol, Symbol) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(env, &id);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        client.register_pair(&s, &d);
        (client, admin, s, d)
    }

    #[test]
    fn test_min_amount_at_bound_is_accepted() {
        let env = Env::default();
        let (client, _admin, s, d) = setup_pair(&env);
        client.set_pair_min_amount(&s, &d, &100i128);
        assert_eq!(client.get_pair_min_amount(&s, &d), 100);
        // Exactly at the floor is accepted (fee 0, no bps configured).
        assert_eq!(client.compute_route_fee(&s, &d, &100i128), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn test_below_min_rejected() {
        let env = Env::default();
        let (client, _admin, s, d) = setup_pair(&env);
        client.set_pair_min_amount(&s, &d, &100i128);
        client.compute_route_fee(&s, &d, &99i128);
    }

    #[test]
    fn test_max_amount_at_bound_is_accepted() {
        let env = Env::default();
        let (client, _admin, s, d) = setup_pair(&env);
        client.set_pair_max_amount(&s, &d, &1_000i128);
        assert_eq!(client.get_pair_max_amount(&s, &d), 1_000);
        assert_eq!(client.compute_route_fee(&s, &d, &1_000i128), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn test_above_max_rejected() {
        let env = Env::default();
        let (client, _admin, s, d) = setup_pair(&env);
        client.set_pair_max_amount(&s, &d, &1_000i128);
        client.compute_route_fee(&s, &d, &1_001i128);
    }

    #[test]
    fn test_liquidity_at_bound_is_accepted() {
        let env = Env::default();
        let (client, admin, s, d) = setup_pair(&env);
        client.set_pair_liquidity(&admin, &s, &d, &500i128);
        assert_eq!(client.get_pair_liquidity(&s, &d), 500);
        // amount == reported liquidity is allowed.
        assert_eq!(client.compute_route_fee(&s, &d, &500i128), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn test_above_liquidity_rejected() {
        let env = Env::default();
        let (client, admin, s, d) = setup_pair(&env);
        client.set_pair_liquidity(&admin, &s, &d, &500i128);
        client.compute_route_fee(&s, &d, &501i128);
    }

    #[test]
    fn test_unset_bounds_behave_as_unbounded() {
        let env = Env::default();
        let (client, _admin, s, d) = setup_pair(&env);
        // Defaults: min 0, max i128::MAX, liquidity unset => unbounded.
        assert_eq!(client.get_pair_min_amount(&s, &d), 0);
        assert_eq!(client.get_pair_max_amount(&s, &d), i128::MAX);
        assert_eq!(client.get_pair_liquidity(&s, &d), 0);
        assert_eq!(client.compute_route_fee(&s, &d, &1i128), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_set_pair_liquidity_rejects_negative() {
        let env = Env::default();
        let (client, admin, s, d) = setup_pair(&env);
        client.set_pair_liquidity(&admin, &s, &d, &-1i128);
    }
}

/// Issue #16 ÔÇö fee-computation arithmetic at extreme amounts.
/// Exercises the `checked_mul` overflow path (returns 0), truncating integer
/// division, quote/compute parity, and the saturating route counter.
#[cfg(test)]
mod test_i16_fee_arithmetic {
    use super::*;
    use soroban_sdk::{symbol_short, testutils::Address as _};

    /// Register a pair with wide bounds and liquidity so the boundary guards
    /// never pre-empt the arithmetic path under test.
    fn setup_pair(env: &Env) -> (StableRouteRouterClient<'_>, Symbol, Symbol) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(env, &id);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        client.register_pair(&s, &d);
        client.set_pair_max_amount(&s, &d, &i128::MAX);
        client.set_pair_liquidity(&admin, &s, &d, &i128::MAX);
        (client, s, d)
    }

    #[test]
    fn test_overflow_path_returns_zero() {
        let env = Env::default();
        let (client, s, d) = setup_pair(&env);
        client.set_pair_fee_bps(&s, &d, &2u32);
        // 2 * i128::MAX overflows checked_mul, so the fee defaults to 0
        // instead of panicking.
        assert_eq!(client.compute_route_fee(&s, &d, &i128::MAX), 0);
    }

    #[test]
    fn test_truncating_division_rounds_toward_zero() {
        let env = Env::default();
        let (client, s, d) = setup_pair(&env);
        client.set_pair_fee_bps(&s, &d, &3u32);
        // 12_345 * 3 / 10_000 = 3.7035 -> truncates to 3.
        assert_eq!(client.compute_route_fee(&s, &d, &12_345i128), 3);
    }

    #[test]
    fn test_quote_matches_compute_fee() {
        let env = Env::default();
        let (client, s, d) = setup_pair(&env);
        client.set_pair_fee_bps(&s, &d, &50u32);
        let (qfee, qnet) = client.quote_route(&s, &d, &1_000_000i128);
        let cfee = client.compute_route_fee(&s, &d, &1_000_000i128);
        assert_eq!(qfee, cfee);
        assert_eq!(qnet, 1_000_000 - qfee);
    }

    #[test]
    fn test_route_counter_increments_and_never_panics() {
        let env = Env::default();
        let (client, s, d) = setup_pair(&env);
        client.set_pair_fee_bps(&s, &d, &10u32);
        assert_eq!(client.get_total_routes_all_time(), 0);
        client.compute_route_fee(&s, &d, &1_000i128);
        assert_eq!(client.get_total_routes_all_time(), 1);
        client.compute_route_fee(&s, &d, &1_000i128);
        assert_eq!(client.get_total_routes_all_time(), 2);
    }
}

/// Issue #17 ÔÇö schema migration path and `get_schema_version` defaults.
/// Covers the default-of-1, the v1->v2 stamp, the double-migration guard
/// (#13), and the admin-auth requirement.
#[cfg(test)]
mod test_i17_migration {
    use super::*;
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    fn setup(env: &Env) -> StableRouteRouterClient<'_> {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(env, &id);
        client
    }

    #[test]
    fn test_schema_version_defaults_to_one() {
        let env = Env::default();
        let client = setup(&env);
        assert_eq!(client.get_schema_version(), 1);
    }

    #[test]
    fn test_migrate_advances_to_two() {
        let env = Env::default();
        let client = setup(&env);
        client.migrate_v1_to_v2();
        assert_eq!(client.get_schema_version(), 2);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #13)")]
    fn test_double_migrate_rejected() {
        let env = Env::default();
        let client = setup(&env);
        client.migrate_v1_to_v2();
        client.migrate_v1_to_v2();
    }

    #[test]
    #[should_panic]
    fn test_migrate_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let id = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "__constructor",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        env.register_at(&id, StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &id);
        client.migrate_v1_to_v2();
    }
}

/// Issue #18 ÔÇö aggregate read surface: `get_pair_info` defaults/values,
/// `is_pair_active`, `quote_route` non-mutation + parity, and
/// `get_pair_last_route_at` before/after a route.
#[cfg(test)]
mod test_i18_read_surface {
    use super::*;
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Ledger},
    };

    fn setup(env: &Env) -> (StableRouteRouterClient<'_>, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(env, &id);
        (client, admin)
    }

    #[test]
    fn test_pair_info_defaults_for_unconfigured_pair() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let info = client.get_pair_info(&symbol_short!("USDC"), &symbol_short!("EURC"));
        assert_eq!(
            info,
            PairInfo {
                registered: false,
                fee_bps: 0,
                min_amount: 0,
                max_amount: i128::MAX,
                liquidity: 0,
                last_route_at: 0,
            }
        );
    }

    #[test]
    fn test_pair_info_reflects_configuration() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        client.register_pair(&s, &d);
        client.set_pair_fee_bps(&s, &d, &25u32);
        client.set_pair_min_amount(&s, &d, &10i128);
        client.set_pair_max_amount(&s, &d, &1_000i128);
        let admin = client.get_admin().expect("constructor stores admin");
        client.set_pair_liquidity(&admin, &s, &d, &500i128);
        let info = client.get_pair_info(&s, &d);
        assert!(info.registered);
        assert_eq!(info.fee_bps, 25);
        assert_eq!(info.min_amount, 10);
        assert_eq!(info.max_amount, 1_000);
        assert_eq!(info.liquidity, 500);
    }

    #[test]
    fn test_is_pair_active_requires_registration_and_liquidity() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        assert!(!client.is_pair_active(&s, &d));
        client.register_pair(&s, &d);
        // Registered but zero liquidity is still inactive.
        assert!(!client.is_pair_active(&s, &d));
        let admin = client.get_admin().expect("constructor stores admin");
        client.set_pair_liquidity(&admin, &s, &d, &1i128);
        assert!(client.is_pair_active(&s, &d));
    }

    #[test]
    fn test_quote_route_is_non_mutating_and_matches_compute() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        client.register_pair(&s, &d);
        client.set_pair_fee_bps(&s, &d, &100u32);
        let (qfee, _net) = client.quote_route(&s, &d, &1_000i128);
        // Quote leaves the counter and timestamp untouched.
        assert_eq!(client.get_total_routes_all_time(), 0);
        assert_eq!(client.get_pair_last_route_at(&s, &d), None);
        // And reports the same fee compute_route_fee would.
        assert_eq!(qfee, client.compute_route_fee(&s, &d, &1_000i128));
    }

    #[test]
    fn test_last_route_at_none_before_some_after() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        client.register_pair(&s, &d);
        env.ledger().set_timestamp(424_242);
        assert_eq!(client.get_pair_last_route_at(&s, &d), None);
        client.compute_route_fee(&s, &d, &1_000i128);
        assert_eq!(client.get_pair_last_route_at(&s, &d), Some(424_242));
    }

    // --- get_pair_info_ext ---

    #[test]
    fn test_pair_info_ext_defaults_for_unconfigured_pair() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        let ext = client.get_pair_info_ext(&s, &d);
        assert_eq!(
            ext,
            PairInfoExt {
                registered: false,
                fee_bps: 0,
                min_amount: 0,
                max_amount: i128::MAX,
                liquidity: 0,
                last_route_at: 0,
                cooldown_secs: 0,
                route_count: 0,
                volume: 0,
            }
        );
        // Sanity check: individual getters agree.
        assert_eq!(ext.registered, client.is_pair_registered(&s, &d));
        assert_eq!(ext.fee_bps, client.get_pair_fee_bps(&s, &d));
        assert_eq!(ext.min_amount, client.get_pair_min_amount(&s, &d));
        assert_eq!(ext.max_amount, client.get_pair_max_amount(&s, &d));
        assert_eq!(ext.liquidity, client.get_pair_liquidity(&s, &d));
        assert_eq!(ext.cooldown_secs, client.get_pair_cooldown(&s, &d));
        assert_eq!(ext.route_count, client.get_pair_route_count(&s, &d));
        assert_eq!(ext.volume, client.get_pair_volume(&s, &d));
    }

    #[test]
    fn test_pair_info_ext_reflects_configuration() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        let admin = client.get_admin().expect("constructor stores admin");
        client.register_pair(&s, &d);
        client.set_pair_fee_bps(&s, &d, &25u32);
        client.set_pair_min_amount(&s, &d, &10i128);
        client.set_pair_max_amount(&s, &d, &1_000i128);
        client.set_pair_liquidity(&admin, &s, &d, &500i128);
        client.set_pair_cooldown(&s, &d, &120u64);

        let ext = client.get_pair_info_ext(&s, &d);
        assert!(ext.registered);
        assert_eq!(ext.fee_bps, 25);
        assert_eq!(ext.min_amount, 10);
        assert_eq!(ext.max_amount, 1_000);
        assert_eq!(ext.liquidity, 500);
        assert_eq!(ext.cooldown_secs, 120);
        assert_eq!(ext.route_count, 0);
        assert_eq!(ext.volume, 0);

        // Individual getters agree.
        assert_eq!(ext.cooldown_secs, client.get_pair_cooldown(&s, &d));
        assert_eq!(ext.route_count, client.get_pair_route_count(&s, &d));
        assert_eq!(ext.volume, client.get_pair_volume(&s, &d));
    }

    #[test]
    fn test_pair_info_ext_after_routing() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        let admin = client.get_admin().expect("constructor stores admin");
        client.register_pair(&s, &d);
        client.set_pair_fee_bps(&s, &d, &10u32);
        client.set_pair_liquidity(&admin, &s, &d, &1_000i128);

        // Route twice to accumulate count and volume.
        client.compute_route_fee(&s, &d, &200i128);
        client.compute_route_fee(&s, &d, &300i128);

        let ext = client.get_pair_info_ext(&s, &d);
        assert!(ext.registered);
        assert_eq!(ext.route_count, 2);
        assert_eq!(ext.volume, 500);
        // Liquidity was debited: 1_000 - 200 - 300 = 500.
        assert_eq!(ext.liquidity, 500);

        // Matches individual getters.
        assert_eq!(ext.route_count, client.get_pair_route_count(&s, &d));
        assert_eq!(ext.volume, client.get_pair_volume(&s, &d));
        assert_eq!(ext.liquidity, client.get_pair_liquidity(&s, &d));
    }

    #[test]
    fn test_pair_info_ext_matches_get_pair_info_base_fields() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let (s, d) = (symbol_short!("XLM"), symbol_short!("USDC"));
        let admin = client.get_admin().expect("constructor stores admin");
        client.register_pair(&s, &d);
        client.set_pair_fee_bps(&s, &d, &50u32);
        client.set_pair_min_amount(&s, &d, &5i128);
        client.set_pair_max_amount(&s, &d, &10_000i128);
        client.set_pair_liquidity(&admin, &s, &d, &2_000i128);

        let info = client.get_pair_info(&s, &d);
        let ext = client.get_pair_info_ext(&s, &d);
        // Base fields must be identical.
        assert_eq!(info.registered, ext.registered);
        assert_eq!(info.fee_bps, ext.fee_bps);
        assert_eq!(info.min_amount, ext.min_amount);
        assert_eq!(info.max_amount, ext.max_amount);
        assert_eq!(info.liquidity, ext.liquidity);
        assert_eq!(info.last_route_at, ext.last_route_at);
    }
}

/// Issue #19 ÔÇö negative authorization coverage. The shared `setup_initialized`
/// uses `mock_all_auths`, so no existing test proves a wrong/missing signer is
/// rejected. Each test here initialises with a scoped mock authorising only
/// `init`, then invokes an admin entrypoint with no matching auth and asserts
/// the call panics. A positive control confirms the call works with auth.
#[cfg(test)]
mod test_i19_authorization {
    use super::*;
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, MockAuth, MockAuthInvoke},
        IntoVal,
    };

    /// Register the constructor with only constructor auth for `admin`; later
    /// privileged calls are intentionally left unauthorised.
    fn setup_scoped(env: &Env) -> StableRouteRouterClient<'_> {
        let admin = Address::generate(env);
        let id = Address::generate(env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "__constructor",
                args: (admin.clone(),).into_val(env),
                sub_invokes: &[],
            },
        }]);
        env.register_at(&id, StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(env, &id);
        client
    }

    #[test]
    #[should_panic]
    fn test_register_pair_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
    }

    #[test]
    #[should_panic]
    fn test_unregister_pair_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.unregister_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
    }

    #[test]
    #[should_panic]
    fn test_set_pair_fee_bps_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &10u32);
    }

    #[test]
    #[should_panic]
    fn test_set_pair_liquidity_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        let caller = Address::generate(&env);
        client.set_pair_liquidity(
            &caller,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &10i128,
        );
    }

    #[test]
    #[should_panic]
    fn test_set_pair_min_amount_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.set_pair_min_amount(&symbol_short!("USDC"), &symbol_short!("EURC"), &1i128);
    }

    #[test]
    #[should_panic]
    fn test_set_pair_max_amount_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.set_pair_max_amount(&symbol_short!("USDC"), &symbol_short!("EURC"), &1i128);
    }

    #[test]
    #[should_panic]
    fn test_set_fee_recipient_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.set_fee_recipient(&Address::generate(&env));
    }

    #[test]
    #[should_panic]
    fn test_pause_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.pause();
    }

    #[test]
    #[should_panic]
    fn test_unpause_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.unpause();
    }

    #[test]
    #[should_panic]
    fn test_propose_admin_transfer_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.propose_admin_transfer(&Address::generate(&env));
    }

    #[test]
    #[should_panic]
    fn test_migrate_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.migrate_v1_to_v2();
    }

    #[test]
    #[should_panic]
    fn test_set_max_fee_absolute_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.set_max_fee_absolute(&1000i128);
    }

    #[test]
    #[should_panic]
    fn test_set_pair_cooldown_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.set_pair_cooldown(&symbol_short!("USDC"), &symbol_short!("EURC"), &100u64);
    }

    #[test]
    #[should_panic]
    fn test_set_oracle_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.set_oracle(&Address::generate(&env));
    }

    #[test]
    #[should_panic]
    fn test_set_timelock_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.set_timelock(&100u64);
    }

    #[test]
    #[should_panic]
    fn test_cancel_admin_transfer_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.cancel_admin_transfer();
    }

    #[test]
    #[should_panic]
    fn test_force_admin_transfer_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.force_admin_transfer(&Address::generate(&env));
    }

    #[test]
    #[should_panic]
    fn test_upgrade_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        client.upgrade(&BytesN::from_array(&env, &[0; 32]));
    }

    #[test]
    #[should_panic]
    fn test_register_pairs_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        let pairs = Vec::from_slice(&env, &[(symbol_short!("USDC"), symbol_short!("EURC"))]);
        client.register_pairs(&pairs);
    }

    #[test]
    #[should_panic]
    fn test_set_pair_fees_bps_requires_admin() {
        let env = Env::default();
        let client = setup_scoped(&env);
        let entries = Vec::from_slice(
            &env,
            &[(symbol_short!("USDC"), symbol_short!("EURC"), 100u32)],
        );
        client.set_pair_fees_bps(&entries);
    }

    /// Positive control: with the admin's auth supplied, the call succeeds.
    #[test]
    fn test_admin_can_register_with_auth() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &id);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
        assert!(client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("EURC")));
    }
}

/// Issue #41 ÔÇö absolute per-route fee ceiling. Both the relative MAX_FEE_BPS
/// and the optional absolute MaxFeeAbsolute apply; the tighter wins. The cap
/// is unset by default (backward compatible).
#[cfg(test)]
mod test_i41_fee_cap {
    use super::*;
    use soroban_sdk::{symbol_short, testutils::Address as _};

    fn setup_pair(env: &Env) -> (StableRouteRouterClient<'_>, Symbol, Symbol) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(env, &id);
        let (s, d) = (symbol_short!("USDC"), symbol_short!("EURC"));
        client.register_pair(&s, &d);
        client.set_pair_fee_bps(&s, &d, &100u32); // 1%
        (client, s, d)
    }

    #[test]
    fn test_no_absolute_cap_by_default() {
        let env = Env::default();
        let (client, s, d) = setup_pair(&env);
        assert_eq!(client.get_max_fee_absolute(), None);
        // 1_000_000 * 1% = 10_000, unclamped.
        assert_eq!(client.compute_route_fee(&s, &d, &1_000_000i128), 10_000);
    }

    #[test]
    fn test_fee_below_cap_is_unaffected() {
        let env = Env::default();
        let (client, s, d) = setup_pair(&env);
        client.set_max_fee_absolute(&50_000i128);
        assert_eq!(client.get_max_fee_absolute(), Some(50_000));
        // 10_000 < 50_000 -> unchanged.
        assert_eq!(client.compute_route_fee(&s, &d, &1_000_000i128), 10_000);
    }

    #[test]
    fn test_fee_above_cap_is_clamped() {
        let env = Env::default();
        let (client, s, d) = setup_pair(&env);
        client.set_max_fee_absolute(&5_000i128);
        // Proportional fee 10_000 clamped down to the 5_000 ceiling.
        assert_eq!(client.compute_route_fee(&s, &d, &1_000_000i128), 5_000);
    }

    #[test]
    fn test_cap_of_zero_makes_routes_free() {
        let env = Env::default();
        let (client, s, d) = setup_pair(&env);
        client.set_max_fee_absolute(&0i128);
        assert_eq!(client.compute_route_fee(&s, &d, &1_000_000i128), 0);
    }

    #[test]
    fn test_quote_and_compute_agree_under_cap() {
        let env = Env::default();
        let (client, s, d) = setup_pair(&env);
        client.set_max_fee_absolute(&5_000i128);
        let (qfee, qnet) = client.quote_route(&s, &d, &1_000_000i128);
        assert_eq!(qfee, 5_000);
        assert_eq!(qnet, 1_000_000 - 5_000);
        assert_eq!(qfee, client.compute_route_fee(&s, &d, &1_000_000i128));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_negative_cap_rejected() {
        let env = Env::default();
        let (client, _s, _d) = setup_pair(&env);
        client.set_max_fee_absolute(&-1i128);
    }
}

#[cfg(test)]
mod test_batch {
    use super::*;
    use soroban_sdk::{symbol_short, testutils::Address as _, vec};

    fn setup(env: &Env) -> (StableRouteRouterClient<'_>, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(env, &id);
        (client, admin)
    }

    fn setup_without_admin(env: &Env) -> StableRouteRouterClient<'_> {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin,));
        env.as_contract(&id, || {
            env.storage().persistent().remove(&DataKey::Admin);
        });
        StableRouteRouterClient::new(env, &id)
    }

    #[test]
    fn test_register_pairs_happy_path() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.register_pairs(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC")),
            (symbol_short!("XLM"), symbol_short!("USDC")),
            (symbol_short!("ETH"), symbol_short!("BTC")),
        ]);
        assert!(client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("EURC")));
        assert!(client.is_pair_registered(&symbol_short!("XLM"), &symbol_short!("USDC")));
        assert!(client.is_pair_registered(&symbol_short!("ETH"), &symbol_short!("BTC")));
    }

    #[test]
    fn test_register_pairs_single_entry_succeeds() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.register_pairs(&vec![&env, (symbol_short!("USDC"), symbol_short!("EURC"))]);
        assert!(client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("EURC")));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #19)")]
    fn test_register_pairs_rejects_empty_batch() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.register_pairs(&vec![&env]);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_register_pairs_atomic_rollback_on_identity() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.register_pairs(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC")),
            (symbol_short!("XLM"), symbol_short!("XLM")),
            (symbol_short!("ETH"), symbol_short!("BTC")),
        ]);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_register_pairs_rejects_when_paused() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.pause();
        client.register_pairs(&vec![&env, (symbol_short!("USDC"), symbol_short!("EURC"))]);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #18)")]
    fn test_register_pairs_rejects_too_large_batch() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let mut pairs = std::vec::Vec::new();
        for i in 0..MAX_BATCH_SIZE + 1 {
            pairs.push((
                Symbol::new(&env, &std::format!("SRC{}", i)),
                Symbol::new(&env, &std::format!("DST{}", i)),
            ));
        }
        client.register_pairs(&Vec::from_slice(&env, &pairs));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_register_pairs_panics_when_uninitialized() {
        let env = Env::default();
        let client = setup_without_admin(&env);
        client.register_pairs(&vec![&env, (symbol_short!("USDC"), symbol_short!("EURC"))]);
    }

    #[test]
    fn test_set_pair_fees_bps_happy_path() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.register_pairs(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC")),
            (symbol_short!("XLM"), symbol_short!("USDC")),
        ]);
        client.set_pair_fees_bps(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC"), 25u32),
            (symbol_short!("XLM"), symbol_short!("USDC"), 50u32),
        ]);
        assert_eq!(
            client.get_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC")),
            25
        );
        assert_eq!(
            client.get_pair_fee_bps(&symbol_short!("XLM"), &symbol_short!("USDC")),
            50
        );
    }

    #[test]
    fn test_set_pair_fees_bps_single_entry_succeeds() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.register_pairs(&vec![&env, (symbol_short!("USDC"), symbol_short!("EURC"))]);
        client.set_pair_fees_bps(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC"), 25u32),
        ]);
        assert_eq!(
            client.get_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC")),
            25
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #19)")]
    fn test_set_pair_fees_bps_rejects_empty_batch() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.set_pair_fees_bps(&vec![&env]);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_set_pair_fees_bps_atomic_rollback_on_high_fee() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.register_pairs(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC")),
            (symbol_short!("XLM"), symbol_short!("USDC")),
        ]);
        client.set_pair_fees_bps(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC"), 25u32),
            (symbol_short!("XLM"), symbol_short!("USDC"), MAX_FEE_BPS + 1),
        ]);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_set_pair_fees_bps_rejects_unregistered_pair() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.set_pair_fees_bps(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC"), 25u32),
        ]);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_set_pair_fees_bps_rejects_when_paused() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        client.register_pairs(&vec![&env, (symbol_short!("USDC"), symbol_short!("EURC"))]);
        client.pause();
        client.set_pair_fees_bps(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC"), 25u32),
        ]);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #18)")]
    fn test_set_pair_fees_bps_rejects_too_large_batch() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let mut entries = std::vec::Vec::new();
        for i in 0..MAX_BATCH_SIZE + 1 {
            entries.push((
                Symbol::new(&env, &std::format!("SRC{}", i)),
                Symbol::new(&env, &std::format!("DST{}", i)),
                10u32,
            ));
        }
        client.set_pair_fees_bps(&Vec::from_slice(&env, &entries));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_pair_fees_bps_panics_when_uninitialized() {
        let env = Env::default();
        let client = setup_without_admin(&env);
        client.set_pair_fees_bps(&vec![
            &env,
            (symbol_short!("USDC"), symbol_short!("EURC"), 25u32),
        ]);
    }
}

/// Issue #153: Test coverage for the version surface and NotInitialized paths.
///
/// This module validates that:
/// - `version()` is stable (`ROUTER_V2`) independent of schema version
/// - `get_schema_version()` returns 1 before any migration (default fallback)
/// - All admin-gated entrypoints panic with `NotInitialized` (#2) on uninitialized contracts
/// - Security invariants: no admin entrypoint succeeds before initialization
#[cfg(test)]
mod test_i153_version_uninitialized {
    use super::*;
    use soroban_sdk::{symbol_short, testutils::Address as _};

    // ========== Helper Setup Functions ==========

    /// Register a contract with admin set (initialized).
    fn setup_initialized(env: &Env) -> (StableRouteRouterClient<'_>, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let contract_id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(env, &contract_id);
        (client, admin)
    }

    /// Register a contract and then remove the admin from storage to simulate an
    /// uninitialized state (admin slot is empty). Used to test NotInitialized (#2) failures.
    fn setup_uninitialized(env: &Env) -> StableRouteRouterClient<'_> {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let contract_id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(env, &contract_id);
        // Remove the admin from storage to simulate uninitialized state.
        env.as_contract(&contract_id, || {
            env.storage().persistent().remove(&DataKey::Admin);
        });
        client
    }

    // ========== Version Surface Tests ==========

    /// `version()` is the fixed contract identity tag; the version constant is stable
    /// across the contract's lifetime.
    #[test]
    fn test_version_returns_router_v2() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);
        assert_eq!(client.version(), symbol_short!("ROUTER_V2"));
    }

    /// `version()` is the fixed contract identity tag and must be entirely
    /// independent of `get_schema_version()`: migrating the storage schema from v1 to v2
    /// advances the schema number but never the version tag.
    #[test]
    fn test_version_constant_independent_of_schema_migration() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);

        // Both are at their initial values.
        assert_eq!(client.version(), symbol_short!("ROUTER_V2"));
        assert_eq!(client.get_schema_version(), 1u32);

        // Perform schema migration.
        client.migrate_v1_to_v2();

        // Schema advanced 1 ÔåÆ 2, but version tag remains `ROUTER_V2`.
        assert_eq!(client.get_schema_version(), 2u32);
        assert_eq!(client.version(), symbol_short!("ROUTER_V2"));
    }

    /// `get_schema_version()` returns 1 (the implicit pre-migration default) when no
    /// schema version has been persisted to storage yet.
    #[test]
    fn test_schema_version_defaults_to_one_when_uninitialized() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        assert_eq!(client.get_schema_version(), 1u32);
    }

    // ========== NotInitialized (#2) Failure Path Tests ==========

    // Every admin-gated entrypoint must panic with `NotInitialized` (#2) when called on a
    // contract that has not had its admin set. This test group validates the security
    // invariant: no admin action succeeds before initialization.

    /// `pause()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_pause_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.pause();
    }

    /// `unpause()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_unpause_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.unpause();
    }

    /// `register_pair()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_register_pair_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.register_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
    }

    /// `register_pairs()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_register_pairs_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.register_pairs(&soroban_sdk::Vec::from_slice(
            &env,
            &[(symbol_short!("USDC"), symbol_short!("EURC"))],
        ));
    }

    /// `set_pair_fee_bps()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_pair_fee_bps_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.set_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC"), &50u32);
    }

    /// `set_pair_fees_bps()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_pair_fees_bps_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.set_pair_fees_bps(&soroban_sdk::Vec::from_slice(
            &env,
            &[(symbol_short!("USDC"), symbol_short!("EURC"), 50u32)],
        ));
    }

    /// `set_pair_min_amount()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_pair_min_amount_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.set_pair_min_amount(&symbol_short!("USDC"), &symbol_short!("EURC"), &10i128);
    }

    /// `set_pair_max_amount()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_pair_max_amount_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.set_pair_max_amount(
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &1_000_000i128,
        );
    }

    /// `set_pair_liquidity()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_pair_liquidity_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        let caller = Address::generate(&env);
        client.set_pair_liquidity(
            &caller,
            &symbol_short!("USDC"),
            &symbol_short!("EURC"),
            &500i128,
        );
    }

    /// `unregister_pair()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_unregister_pair_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.unregister_pair(&symbol_short!("USDC"), &symbol_short!("EURC"));
    }

    /// `propose_admin_transfer()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_propose_admin_transfer_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        let new_admin = Address::generate(&env);
        client.propose_admin_transfer(&new_admin);
    }

    /// `cancel_admin_transfer()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_cancel_admin_transfer_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.cancel_admin_transfer();
    }

    /// `set_fee_recipient()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_fee_recipient_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        let recipient = Address::generate(&env);
        client.set_fee_recipient(&recipient);
    }

    /// `set_timelock()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_timelock_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.set_timelock(&100u64);
    }

    /// `set_pair_cooldown()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_pair_cooldown_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.set_pair_cooldown(&symbol_short!("USDC"), &symbol_short!("EURC"), &60u64);
    }

    /// `set_oracle()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_oracle_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        let oracle = Address::generate(&env);
        client.set_oracle(&oracle);
    }

    /// `set_max_fee_absolute()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_max_fee_absolute_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.set_max_fee_absolute(&1_000i128);
    }

    /// `migrate_v1_to_v2()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_migrate_v1_to_v2_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        client.migrate_v1_to_v2();
    }

    /// `upgrade()` panics with `NotInitialized` (#2) when called on an uninitialized contract.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_upgrade_panics_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);
        let dummy_hash = BytesN::from_array(&env, &[0u8; 32]);
        client.upgrade(&dummy_hash);
    }

    // ========== Security Invariant Validation ==========

    /// All read-only entrypoints (version, schema_version, pair queries) succeed on
    /// uninitialized contracts (no admin required for reads).
    #[test]
    fn test_read_only_operations_work_on_uninitialized_contract() {
        let env = Env::default();
        let client = setup_uninitialized(&env);

        // These all succeed because they are read-only (no admin check).
        assert_eq!(client.version(), symbol_short!("ROUTER_V2"));
        assert_eq!(client.get_schema_version(), 1u32);
        assert!(!client.is_paused());
        assert_eq!(client.get_admin(), None);
        assert_eq!(client.get_pending_admin(), None);
        assert_eq!(client.get_timelock(), 0u64);
        assert_eq!(client.get_pending_admin_eta(), None);
        assert_eq!(client.get_fee_recipient(), None);
        assert_eq!(client.get_oracle(), None);
        assert_eq!(client.get_max_fee_absolute(), None);
        assert!(!client.is_pair_registered(&symbol_short!("USDC"), &symbol_short!("EURC")));
        assert_eq!(
            client.get_pair_fee_bps(&symbol_short!("USDC"), &symbol_short!("EURC")),
            0u32
        );
        assert_eq!(
            client.get_pair_min_amount(&symbol_short!("USDC"), &symbol_short!("EURC")),
            0i128
        );
        assert_eq!(
            client.get_pair_max_amount(&symbol_short!("USDC"), &symbol_short!("EURC")),
            i128::MAX
        );
        assert_eq!(
            client.get_pair_liquidity(&symbol_short!("USDC"), &symbol_short!("EURC")),
            0i128
        );
    }

    /// Version and schema version are separate concepts: `version()` is stable,
    /// while `get_schema_version()` evolves with migrations. On an initialized but
    /// unmigrated contract, both are at their initial values.
    #[test]
    fn test_version_and_schema_version_are_separate_concepts() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);

        // Version is a constant, schema_version is a persistent value.
        let version = client.version();
        let schema = client.get_schema_version();

        assert_eq!(version, symbol_short!("ROUTER_V2"));
        assert_eq!(schema, 1u32);
        // These are distinct types and values - Symbol vs u32.
    }

    /// After initialization, admin-gated operations become available (they do not panic
    /// with NotInitialized). This test verifies the initialization unlocks admin gates.
    #[test]
    fn test_admin_operations_succeed_after_initialization() {
        let env = Env::default();
        let (client, _admin) = setup_initialized(&env);

        // These now succeed because initialization has set the admin.
        client.pause();
        assert!(client.is_paused());
        client.unpause();
        assert!(!client.is_paused());
    }
}

/// Issue #165: per-pair cooldown rate limit using ledger timestamp control.
///
/// Covers:
/// - `set_pair_cooldown` rejects cooldown above `MAX_COOLDOWN_SECS` and requires
///   a registered pair (consistent with other config setters)
/// - `get_pair_cooldown` defaults to 0 (disabled)
/// - Cooldown 0 (disabled) allows back-to-back routes
/// - First route always passes regardless of cooldown setting
/// - Cooldown blocks a second route within the window (`RouteCooldownActive`)
/// - Cooldown allows a route after the window elapses (ledger timestamp advance)
/// - Cooldown is per-pair ÔÇö independent cooldown states for different pairs
/// - `set_pair_cooldown` emits a `cd_set` event
/// - `compute_route_fee` stamps `PairLastRouteAt` which the cooldown gate reads
#[cfg(test)]
mod test_i165_cooldown_rate_limit {
    use super::*;
    use crate::test::event_payloads;
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Ledger},
    };

    fn setup_pair(env: &Env) -> (StableRouteRouterClient<'_>, Symbol, Symbol) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(env, &id);
        let src = symbol_short!("USDC");
        let dst = symbol_short!("EURC");
        client.register_pair(&src, &dst);
        (client, src, dst)
    }

    // --- set_pair_cooldown validation ---

    #[test]
    #[should_panic(expected = "Error(Contract, #20)")]
    fn test_set_pair_cooldown_rejects_above_max() {
        let env = Env::default();
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_cooldown(&src, &dst, &(MAX_COOLDOWN_SECS + 1));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_set_pair_cooldown_rejects_unregistered_pair() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &id);
        client.set_pair_cooldown(&symbol_short!("USDC"), &symbol_short!("EURC"), &60u64);
    }

    // --- get_pair_cooldown defaults ---

    #[test]
    fn test_get_pair_cooldown_defaults_to_zero() {
        let env = Env::default();
        let (client, src, dst) = setup_pair(&env);
        assert_eq!(client.get_pair_cooldown(&src, &dst), 0);
    }

    #[test]
    fn test_get_pair_cooldown_after_set() {
        let env = Env::default();
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_cooldown(&src, &dst, &120u64);
        assert_eq!(client.get_pair_cooldown(&src, &dst), 120);
    }

    // --- cooldown disabled (0) allows back-to-back routes ---

    #[test]
    fn test_cooldown_zero_allows_immediate_reroute() {
        let env = Env::default();
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_fee_bps(&src, &dst, &10u32);
        // Cooldown defaults to 0 (disabled).
        let fee1 = client.compute_route_fee(&src, &dst, &1_000i128);
        let fee2 = client.compute_route_fee(&src, &dst, &1_000i128);
        assert_eq!(fee1, fee2);
        assert_eq!(client.get_pair_route_count(&src, &dst), 2);
    }

    // --- first route always passes ---

    #[test]
    fn test_first_route_passes_with_cooldown_set() {
        let env = Env::default();
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_cooldown(&src, &dst, &3600u64);
        // No prior route ÔÇö no last_route_at timestamp ÔÇö first call passes.
        assert_eq!(client.compute_route_fee(&src, &dst, &500i128), 0);
    }

    // --- cooldown blocks immediate second route ---

    #[test]
    #[should_panic(expected = "Error(Contract, #17)")]
    fn test_cooldown_blocks_second_route_within_window() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_cooldown(&src, &dst, &100u64);
        // First route succeeds, stamping last_route_at = 1_000.
        client.compute_route_fee(&src, &dst, &500i128);
        // Second route at same timestamp (t = 1_000) ÔÇö cooldown not elapsed.
        client.compute_route_fee(&src, &dst, &500i128);
    }

    // --- cooldown allows route after window elapses ---

    #[test]
    fn test_cooldown_allows_route_after_window_elapses() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_cooldown(&src, &dst, &100u64);
        // First route at t = 1_000.
        client.compute_route_fee(&src, &dst, &500i128);
        // Advance past the cooldown window.
        env.ledger().set_timestamp(1_100);
        // Second route at t = 1_100 ÔÇö exactly at last + cooldown.
        let fee = client.compute_route_fee(&src, &dst, &500i128);
        assert_eq!(fee, 0);
        assert_eq!(client.get_pair_route_count(&src, &dst), 2);
    }

    #[test]
    fn test_cooldown_allows_route_well_after_window() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_cooldown(&src, &dst, &100u64);
        client.compute_route_fee(&src, &dst, &500i128);
        // Advance far beyond the cooldown.
        env.ledger().set_timestamp(9_999);
        let fee = client.compute_route_fee(&src, &dst, &500i128);
        assert_eq!(fee, 0);
        assert_eq!(client.get_pair_route_count(&src, &dst), 2);
    }

    // --- cooldown is per-pair (independent state) ---

    #[test]
    fn test_cooldown_is_per_pair_independent() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &id);

        let src_a = symbol_short!("USDC");
        let dst_a = symbol_short!("EURC");
        let src_b = symbol_short!("XLM");
        let dst_b = symbol_short!("USDC");

        client.register_pair(&src_a, &dst_a);
        client.register_pair(&src_b, &dst_b);
        client.set_pair_cooldown(&src_a, &dst_a, &200u64);
        client.set_pair_cooldown(&src_b, &dst_b, &200u64);

        // Route pair A at t = 1_000.
        client.compute_route_fee(&src_a, &dst_a, &100i128);
        // Route pair B at t = 1_000 (different pair, independent cooldown).
        client.compute_route_fee(&src_b, &dst_b, &100i128);

        // Both should have last_route_at = 1_000.
        assert_eq!(client.get_pair_last_route_at(&src_a, &dst_a), Some(1_000));
        assert_eq!(client.get_pair_last_route_at(&src_b, &dst_b), Some(1_000));

        // Advance by 100 ÔÇö not enough for pair A (cooldown 200), but
        // we can verify pair B also blocked at the same timestamp.
        env.ledger().set_timestamp(1_100);
        let err_a = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.compute_route_fee(&src_a, &dst_a, &100i128);
        }));
        assert!(err_a.is_err(), "pair A should still be in cooldown");

        let err_b = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.compute_route_fee(&src_b, &dst_b, &100i128);
        }));
        assert!(err_b.is_err(), "pair B should still be in cooldown");

        // Advance to t = 1_200 ÔÇö exactly at last + cooldown for both.
        env.ledger().set_timestamp(1_200);
        client.compute_route_fee(&src_a, &dst_a, &200i128);
        client.compute_route_fee(&src_b, &dst_b, &200i128);
        assert_eq!(client.get_pair_route_count(&src_a, &dst_a), 2);
        assert_eq!(client.get_pair_route_count(&src_b, &dst_b), 2);
    }

    // --- set_pair_cooldown emits cd_set event ---

    #[test]
    fn test_set_pair_cooldown_emits_event() {
        let env = Env::default();
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_cooldown(&src, &dst, &300u64);
        let payloads = event_payloads(&env, symbol_short!("cd_set"));
        assert_eq!(
            payloads.len(),
            1,
            "set_pair_cooldown emits exactly one cd_set event"
        );
        let decoded: (Symbol, Symbol, u64) =
            soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
                .expect("cd_set event data decodes to (Symbol, Symbol, u64)");
        assert_eq!(decoded, (src, dst, 300u64));
    }

    // --- compute_route_fee stamps last_route_at after route ---

    #[test]
    fn test_cooldown_stamps_last_route_at() {
        let env = Env::default();
        env.ledger().set_timestamp(42_000);
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_cooldown(&src, &dst, &500u64);
        assert_eq!(client.get_pair_last_route_at(&src, &dst), None);
        client.compute_route_fee(&src, &dst, &1_000i128);
        assert_eq!(client.get_pair_last_route_at(&src, &dst), Some(42_000));
    }

    // --- cooldown respects exact boundary (last + cooldown == timestamp) ---

    #[test]
    fn test_cooldown_boundary_at_last_plus_cooldown() {
        let env = Env::default();
        env.ledger().set_timestamp(5_000);
        let (client, src, dst) = setup_pair(&env);
        client.set_pair_cooldown(&src, &dst, &300u64);
        client.compute_route_fee(&src, &dst, &100i128);
        // At t = 5_299, still in cooldown (5_000 + 300 = 5_300).
        env.ledger().set_timestamp(5_299);
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.compute_route_fee(&src, &dst, &100i128);
        }));
        assert!(err.is_err(), "should be blocked at t = last + cooldown - 1");

        // At t = 5_300, exactly at the boundary: allowed.
        env.ledger().set_timestamp(5_300);
        client.compute_route_fee(&src, &dst, &100i128);
        assert_eq!(client.get_pair_route_count(&src, &dst), 2);
    }

    // ------------------------------------------------------------------
    //  Savings data model tests (Issue #298)
    // ------------------------------------------------------------------

    fn setup_savings(env: &Env) -> (StableRouteRouterClient<'_>, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let id = env.register(StableRouteRouter, (admin.clone(),));
        let client = StableRouteRouterClient::new(env, &id);
        client.init_savings(&100u32); // 1 % annual yield
        (client, admin)
    }

    // --- init_savings ---

    #[test]
    fn test_init_savings_sets_config() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &id);

        client.init_savings(&250u32);
        let config = client
            .get_savings_config()
            .expect("savings config should be Some after init");
        assert_eq!(config.yield_rate_bps, 250);
        assert_eq!(config.total_principal, 0);
        assert_eq!(config.total_yield, 0);
        assert!(config.initialized);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #23)")]
    fn test_init_savings_rejects_double_init() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        client.init_savings(&200u32);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #24)")]
    fn test_init_savings_rejects_rate_too_high() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &id);
        client.init_savings(&(MAX_YIELD_RATE_BPS + 1));
    }

    #[test]
    fn test_init_savings_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &id);

        client.init_savings(&500u32);
        let payloads = event_payloads(&env, symbol_short!("sv_init"));
        assert_eq!(
            payloads.len(),
            1,
            "init_savings emits exactly one sv_init event"
        );
        let decoded: u32 = soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
            .expect("sv_init event data decodes to u32");
        assert_eq!(decoded, 500u32);
    }

    // --- get_savings_config ---

    #[test]
    fn test_get_savings_config_none_before_init() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &id);
        assert_eq!(client.get_savings_config(), None);
    }

    // --- deposit_savings ---

    #[test]
    fn test_deposit_savings_creates_account() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &1_000i128);
        let info = client
            .get_savings_info(&user)
            .expect("savings info should be Some after deposit");
        assert_eq!(info.principal, 1_000);
        assert_eq!(info.yield_earned, 0);
        assert_eq!(info.last_accrued, 1_000_000);

        let config = client
            .get_savings_config()
            .expect("savings config should be Some");
        assert_eq!(config.total_principal, 1_000);
        assert_eq!(config.total_yield, 0);
    }

    #[test]
    fn test_deposit_savings_multiple_deposits() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &500i128);
        client.deposit_savings(&user, &1_500i128);
        let info = client
            .get_savings_info(&user)
            .expect("savings info should be Some");
        assert_eq!(info.principal, 2_000);
        assert_eq!(info.yield_earned, 0);
    }

    #[test]
    fn test_deposit_savings_tracks_global_total() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.deposit_savings(&alice, &2_000i128);
        client.deposit_savings(&bob, &3_000i128);
        let config = client.get_savings_config().expect("config exists");
        assert_eq!(config.total_principal, 5_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #25)")]
    fn test_deposit_savings_rejects_zero() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);
        client.deposit_savings(&user, &0i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #25)")]
    fn test_deposit_savings_rejects_negative() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);
        client.deposit_savings(&user, &(-100i128));
    }

    #[test]
    fn test_deposit_savings_emits_event() {
        let env = Env::default();
        env.ledger().set_timestamp(2_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &10_000i128);
        let payloads = event_payloads(&env, symbol_short!("sv_dep"));
        assert_eq!(
            payloads.len(),
            1,
            "deposit_savings emits exactly one sv_dep event"
        );
        let decoded: (Address, i128, i128) =
            soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
                .expect("sv_dep event data decodes to (Address, i128, i128)");
        assert_eq!(decoded.0, user);
        assert_eq!(decoded.1, 10_000i128);
        assert_eq!(decoded.2, 10_000i128);
    }

    // --- get_savings_info ---

    #[test]
    fn test_get_savings_info_returns_none_for_unknown_user() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);
        assert_eq!(client.get_savings_info(&user), None);
    }

    #[test]
    fn test_get_savings_info_shows_accrued_yield_without_writing() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &1_000_000i128);

        // Advance one full year at 1 % (100 bps).
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);

        // Read-only view should compute yield = 1M * 100 / 10_000 = 10_000.
        let info = client.get_savings_info(&user).expect("info should be Some");
        assert_eq!(info.yield_earned, 10_000);
        assert_eq!(info.principal, 1_000_000);
        assert_eq!(info.last_accrued, 1_000_000 + YEAR_SECS as u64);

        // A second read at the same timestamp returns the same value (no double accrual).
        let info2 = client.get_savings_info(&user).expect("info exists");
        assert_eq!(info2.yield_earned, 10_000);

        // Now persist via accrue_yield at same timestamp. Since read-only
        // view does NOT write storage, the stored last_accrued is still
        // the deposit timestamp.  Calling accrue_yield now should produce
        // the same increment as the read-only view.
        client.accrue_yield(&user);

        // After persistence, a read should match.
        let info3 = client.get_savings_info(&user).expect("info exists");
        assert_eq!(info3.yield_earned, 10_000);
        assert_eq!(info3.last_accrued, 1_000_000 + YEAR_SECS as u64);
    }

    // --- withdraw_savings ---

    #[test]
    fn test_withdraw_savings_from_yield_first() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &10_000i128);
        // Advance one year so yield = 10_000 * 100 / 10_000 = 100 (at 1 % = 100 bps)
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);

        // Withdraw 50 ÔÇö should come entirely from yield since yield=100.
        client.withdraw_savings(&user, &50i128);
        let info = client
            .get_savings_info(&user)
            .expect("info exists after partial withdraw");
        assert_eq!(info.principal, 10_000);
        assert_eq!(info.yield_earned, 50); // 100 - 50
    }

    #[test]
    fn test_withdraw_savings_dips_into_principal_when_yield_exhausted() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &10_000i128);
        // Advance one year so yield = 100.
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);

        // Withdraw 200 ÔÇö 100 from yield, 100 from principal.
        client.withdraw_savings(&user, &200i128);
        let info = client
            .get_savings_info(&user)
            .expect("info exists after withdraw");
        assert_eq!(info.principal, 9_900); // 10_000 - 100
        assert_eq!(info.yield_earned, 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #22)")]
    fn test_withdraw_savings_rejects_exceeding_balance() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &100i128);
        client.withdraw_savings(&user, &101i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #22)")]
    fn test_withdraw_savings_rejects_no_account() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);
        client.withdraw_savings(&user, &1i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #25)")]
    fn test_withdraw_savings_rejects_zero() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);
        client.deposit_savings(&user, &100i128);
        client.withdraw_savings(&user, &0i128);
    }

    #[test]
    fn test_withdraw_savings_drains_full_and_removes_slot() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &5_000i128);
        // Withdraw exactly the full balance (principal only, no yield elapsed).
        client.withdraw_savings(&user, &5_000i128);
        assert_eq!(
            client.get_savings_info(&user),
            None,
            "slot should be removed after full drain"
        );
        let config = client.get_savings_config().expect("config exists");
        assert_eq!(config.total_principal, 0);
        assert_eq!(config.total_yield, 0);
    }

    #[test]
    fn test_withdraw_savings_emits_event() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &10_000i128);
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);
        client.withdraw_savings(&user, &150i128);

        let payloads = event_payloads(&env, symbol_short!("sv_wd"));
        assert_eq!(
            payloads.len(),
            1,
            "withdraw_savings emits exactly one sv_wd event"
        );
        // (user, amount, remaining_principal, remaining_yield)
        let decoded: (Address, i128, i128, i128) =
            soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
                .expect("sv_wd event decodes to (Address, i128, i128, i128)");
        assert_eq!(decoded.0, user);
        assert_eq!(decoded.1, 150);
        // yield = 100, so 150 withdraw = 100 yield + 50 principal
        assert_eq!(decoded.2, 9_950); // remaining principal
        assert_eq!(decoded.3, 0); // remaining yield
    }

    // --- accrue_yield ---

    #[test]
    fn test_accrue_yield_persists_correct_increment() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &1_000_000i128);
        // Advance exactly one year.
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);

        client.accrue_yield(&user);
        let info = client
            .get_savings_info(&user)
            .expect("info exists after accrual");
        assert_eq!(info.yield_earned, 10_000); // 1M * 1% = 10_000
        assert_eq!(info.last_accrued, 1_000_000 + YEAR_SECS as u64);
    }

    #[test]
    fn test_accrue_yield_multiple_periods() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &1_000_000i128);
        // Advance one year and accrue.
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);
        client.accrue_yield(&user);

        // Another year passes.
        env.ledger().set_timestamp(1_000_000 + 2 * YEAR_SECS as u64);
        client.accrue_yield(&user);

        let info = client.get_savings_info(&user).expect("info exists");
        assert_eq!(info.yield_earned, 20_000); // 2 years at 1%
        assert_eq!(info.last_accrued, 1_000_000 + 2 * YEAR_SECS as u64);
    }

    #[test]
    fn test_accrue_yield_updates_global_total_yield() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.deposit_savings(&alice, &2_000_000i128);
        client.deposit_savings(&bob, &3_000_000i128);
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);

        client.accrue_yield(&alice);
        let config = client.get_savings_config().expect("config exists");
        assert_eq!(config.total_yield, 20_000); // 2M * 1% = 20_000

        client.accrue_yield(&bob);
        let config = client.get_savings_config().expect("config exists");
        assert_eq!(config.total_yield, 50_000); // 20_000 + 3M * 1% = 50_000
    }

    #[test]
    fn test_accrue_yield_noop_on_unknown_user() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);
        // Should not panic.
        client.accrue_yield(&user);
    }

    #[test]
    fn test_accrue_yield_noop_when_time_not_advanced() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &1_000_000i128);
        // Accrue at t=1_000_000 ÔÇö deposit already set last_accrued to this,
        // so now == last_accrued ÔåÆ should be a no-op.
        client.accrue_yield(&user);
        let info = client.get_savings_info(&user).expect("info exists");
        assert_eq!(info.yield_earned, 0);
        assert_eq!(info.last_accrued, 1_000_000);
    }

    #[test]
    fn test_accrue_yield_emits_event() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &1_000_000i128);
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);

        client.accrue_yield(&user);
        let payloads = event_payloads(&env, symbol_short!("sv_acc"));
        assert_eq!(
            payloads.len(),
            1,
            "accrue_yield emits exactly one sv_acc event"
        );
        let decoded: (Address, i128, i128) =
            soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
                .expect("sv_acc event decodes to (Address, i128, i128)");
        assert_eq!(decoded.0, user);
        assert_eq!(decoded.1, 10_000); // yield increment
        assert_eq!(decoded.2, 10_000); // global total_yield after
    }

    // --- set_yield_rate ---

    #[test]
    fn test_set_yield_rate_updates_config() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        client.set_yield_rate(&200u32); // 2 %
        let config = client
            .get_savings_config()
            .expect("config exists after set_yield_rate");
        assert_eq!(config.yield_rate_bps, 200);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #24)")]
    fn test_set_yield_rate_rejects_too_high() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        client.set_yield_rate(&(MAX_YIELD_RATE_BPS + 1));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #21)")]
    fn test_set_yield_rate_rejects_uninitialized() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(StableRouteRouter, (admin,));
        let client = StableRouteRouterClient::new(&env, &id);
        client.set_yield_rate(&100u32);
    }

    #[test]
    fn test_set_yield_rate_emits_event() {
        let env = Env::default();
        let (client, _admin) = setup_savings(&env);
        client.set_yield_rate(&300u32);
        let payloads = event_payloads(&env, symbol_short!("yield_set"));
        assert_eq!(
            payloads.len(),
            1,
            "set_yield_rate emits exactly one yield_set event"
        );
        let decoded: u32 = soroban_sdk::TryFromVal::try_from_val(&env, &payloads[0])
            .expect("yield_set event data decodes to u32");
        assert_eq!(decoded, 300u32);
    }

    // --- accrue_yield updates last_accrued (no double-accrual) ---

    #[test]
    fn test_accrue_yield_then_get_savings_info_no_double_accrual() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &1_000_000i128);
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);
        client.accrue_yield(&user); // persists yield = 10_000
                                    // Immediately read back ÔÇö should show same value.
        let info = client.get_savings_info(&user).expect("info exists");
        assert_eq!(info.yield_earned, 10_000);
        assert_eq!(info.last_accrued, 1_000_000 + YEAR_SECS as u64);
    }

    // --- withdraw after deposit accrues yield automatically ---

    #[test]
    fn test_deposit_accrues_yield_automatically() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        // Deposit 1M, let time pass.
        client.deposit_savings(&user, &1_000_000i128);
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);

        // A second deposit should first accrue year 1 yield, then add principal.
        client.deposit_savings(&user, &500_000i128);
        let info = client.get_savings_info(&user).expect("info exists");
        assert_eq!(info.yield_earned, 10_000); // yield on first 1M for 1 year
        assert_eq!(info.principal, 1_500_000); // 1M + 500k
        assert_eq!(info.last_accrued, 1_000_000 + YEAR_SECS as u64);
    }

    // --- principal / yield separation invariant ---

    #[test]
    fn test_principal_never_decreases_from_yield_accrual() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &1_000i128);
        let principal_before = client.get_savings_info(&user).unwrap().principal;

        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);
        client.accrue_yield(&user);

        let info = client.get_savings_info(&user).unwrap();
        assert_eq!(
            info.principal, principal_before,
            "yield accrual must never modify principal"
        );
        assert!(
            info.yield_earned > 0,
            "yield should be positive after a year"
        );
    }

    #[test]
    fn test_yield_earned_monotonic() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000_000);
        let (client, _admin) = setup_savings(&env);
        let user = Address::generate(&env);

        client.deposit_savings(&user, &1_000_000i128);

        // Accrue at t=1 (1 sec after deposit).
        env.ledger().set_timestamp(1_000_001);
        client.accrue_yield(&user);
        let yield_t1 = client.get_savings_info(&user).unwrap().yield_earned;

        // Accrue at t=year.
        env.ledger().set_timestamp(1_000_000 + YEAR_SECS as u64);
        client.accrue_yield(&user);
        let yield_t2 = client.get_savings_info(&user).unwrap().yield_earned;

        assert!(yield_t2 > yield_t1, "yield should be strictly monotonic");
    }
}
