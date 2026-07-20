# StableRoute ÔÇö Storage Model & DataKey Reference

## Savings module overview

The savings data model (added in Issue #298) tracks each user's deposited capital
(**principal**) separately from the yield it has generated (**yield_earned**). Two
new `DataKey` variants were added: `SavingsAccount(Address)` (per-user) and
`SavingsConfig` (singleton). The `SavingsConfig` slot holds the annual yield rate
(in basis points) plus aggregate totals across all users. Design decisions:

- **Principal is sacred** ÔÇö deposits are always credited to principal; withdrawals
  debit yield_earned before touching principal. Yield accrual never modifies
  principal.
- **Yield is time-based** ÔÇö accrued via `principal * rate * elapsed / (YEAR_SECS * 10_000)`,
  using `u128` intermediates to avoid overflow. The `load_savings_with_accrual`
  helper returns an up-to-date snapshot without writing to storage; callers must
  invoke `accrue_yield` explicitly to persist.
- **Slot cleanup** ÔÇö when a user's entire balance (principal + yield) is withdrawn,
  their `SavingsAccount` slot is removed entirely, keeping storage lean.
- **Read-only view** ÔÇö `get_savings_info` computes pending yield ephemerally and
  returns it to the caller without writing, so gas-free dashboard queries are
  always current.
- **Event-driven** ÔÇö every state-changing savings entrypoint (`init_savings`,
  `deposit_savings`, `withdraw_savings`, `accrue_yield`, `set_yield_rate`) emits
  its own typed event so indexers can track principal and yield movements.

Authoritative reference for the router's on-chain storage
([`src/lib.rs`](../src/lib.rs)). Every `DataKey` variant is listed with its key
shape, value type, storage tier, default-when-absent, the entrypoints that
read/write it, and its TTL class. Defaults are cross-checked against the
`unwrap_or` values in the source.

## Sentinel conventions

- An **absent `bool`** reads as `false` (pair registration, paused,
  reentrancy lock).
- **`i128::MAX`** is the "unbounded" sentinel for `PairMaxAmount` and for
  liquidity *inside `compute_route_fee` only*.
- **`0`** is the default for counters, fees, timestamps (as `u64`),
  `PairMinAmount`, and cooldowns.
- An **absent `Option`** stays `None` (admin, pending admin, fee recipient,
  last-route timestamp, max fee absolute, oracle) ÔÇö distinct from a zero
  value.
- `SchemaVersion` defaults to **`1`** when absent (the implicit pre-migration
  default).

## Storage tier

All twenty-two `DataKey` slots live in **persistent** storage; the contract uses
no instance or temporary storage today. Persistent entries are subject to
state archival once their TTL lapses: a pair configured long ago but not
routed recently can have its entries archived and must be restored (bumped)
before use.

### TTL classes

| Class | Description | Write frequency | Archival risk |
|-------|-------------|-----------------|---------------|
| **Static** | Written once at construction or migration; never changed afterward | Once | Low ÔÇö bump once after deploy |
| **Config** | Admin-gated governance/config writes | Rare (governance events) | Moderate ÔÇö bump after each governance action |
| **Hot** | Written on every `compute_route_fee` call | Every route | **High** ÔÇö each route extends TTL naturally; but infrequently-routed pairs' hot slots can archive |

The primary TTL mitigation is the natural write frequency of hot slots: every
`compute_route_fee` call extends the TTL of `TotalRoutesAllTime`,
`PairLastRouteAt`, `PairRouteCount`, `PairVolume`, and (when set)
`PairLiquidity`. The `ReentrancyLock` is also written per-route.
`SavingsAccount` slots are refreshed on every user action (deposit, withdraw,
accrue), so active savers' entries stay live. For infrequently-routed pairs
or dormant savings accounts, a dedicated TTL-extension ("bump") pass on
persistent keys is the reference mitigation.

## DataKey table

### Global singletons

| DataKey | Value type | Tier | TTL class | Default when absent | Read by | Written by |
|---|---|---|---|---|---|---|
| `Admin` | `Address` | persistent | **Static** | `None` ÔåÆ `NotInitialized` (#2) | `get_admin`, `require_admin` | `__constructor`, `accept_admin_transfer`, `force_admin_transfer` |
| `PendingAdmin` | `Address` | persistent | **Config** | `None` | `get_pending_admin`, `get_pending_admin_info`, `accept_admin_transfer`, `force_admin_transfer` | `propose_admin_transfer`; removed by `accept_admin_transfer`, `force_admin_transfer`, `cancel_admin_transfer` |
| `PendingAdminEta` | `u64` | persistent | **Config** | `None` | `get_pending_admin_eta`, `get_pending_admin_info`, `accept_admin_transfer`, `force_admin_transfer` | `propose_admin_transfer`; removed by `accept_admin_transfer`, `force_admin_transfer`, `cancel_admin_transfer` |
| `Timelock` | `u64` | persistent | **Config** | `0` (instant handover) | `get_timelock`, `propose_admin_transfer` | `set_timelock` |
| `Paused` | `bool` | persistent | **Config** | `false` | `is_paused`, `register_pair`, `register_pairs`, `set_pair_fee_bps`, `set_pair_fees_bps`, `compute_route_fee` | `pause`, `unpause` |
| `FeeRecipient` | `Address` | persistent | **Config** | `None` | `get_fee_recipient` | `set_fee_recipient` |
| `MaxFeeAbsolute` | `i128` | persistent | **Config** | `None` | `get_max_fee_absolute`, `apply_fee_cap` (in `compute_route_fee` and `quote_route`) | `set_max_fee_absolute` |
| `Oracle` | `Address` | persistent | **Config** | `None` | `get_oracle`, `set_pair_liquidity` (dual-auth check) | `set_oracle`; removed by `remove_oracle` |
| `TotalRoutesAllTime` | `u64` | persistent | **Hot** | `0` | `get_total_routes_all_time` | `compute_route_fee` (saturating `+1`) |
| `SchemaVersion` | `u32` | persistent | **Static** | `1` (implicit v1) | `get_schema_version` | `migrate_v1_to_v2` |
| `ReentrancyLock` | `bool` | persistent | **Hot** | `false` | `enter_nonreentrant` | `enter_nonreentrant` (ÔåÆ `true`), `exit_nonreentrant` (ÔåÆ `false`) |
| `SavingsConfig` | `SavingsConfig` | persistent | **Config** | `None` ÔåÆ `SavingsNotInitialized` (#21) | `get_savings_config`, `require_savings_initialized`, `deposit_savings`, `withdraw_savings`, `accrue_yield` | `init_savings`; updated by `set_yield_rate`, `deposit_savings`, `withdraw_savings`, `accrue_yield` |

### Per-user savings slots ÔÇö `SavingsAccount(Address)`

| DataKey | Value type | Tier | TTL class | Default when absent | Read by | Written by |
|---|---|---|---|---|---|---|
| `SavingsAccount(Address)` | `SavingsInfo` | persistent | **Config**ÔÇá | `None` ÔÇö no account for that address | `get_savings_info`, `load_savings_with_accrual` (in `deposit_savings`, `withdraw_savings`, `accrue_yield`) | `deposit_savings` (create/update), `withdraw_savings` (update/remove), `accrue_yield` (update) |

ÔÇá Savings accounts are written on each user action (deposit, withdraw, accrue),
which is less frequent than route hot slots but more frequent than governance
config. Classified **Config** because the write frequency depends on user
behaviour rather than protocol activity.

### Per-pair slots ÔÇö `(Symbol, Symbol)`

All per-pair slots are keyed by `(source, destination)` tuple. Direction
matters: `(USDC, EURC)` and `(EURC, USDC)` are independent storage slots.

| DataKey | Value type | Tier | TTL class | Default when absent | Read by | Written by |
|---|---|---|---|---|---|---|
| `Pair` | `bool` | persistent | **Config** | `false` (not registered) | `is_pair_registered`, `is_pair_active`, `get_pair_info`, `get_pair_info_ext`, `require_pair_registered`, `compute_route_fee`, `quote_route` | `register_pair`, `register_pairs`; removed by `unregister_pair` |
| `PairFeeBps` | `u32` | persistent | **Config** | `0` (free) | `get_pair_fee_bps`, `get_pair_info`, `get_pair_info_ext`, `compute_route_fee`, `quote_route` | `set_pair_fee_bps`, `set_pair_fees_bps`; cleared by `clear_pair_config` (`unregister_pair`) |
| `PairMinAmount` | `i128` | persistent | **Config** | `0` (no floor) | `get_pair_min_amount`, `get_pair_info`, `get_pair_info_ext`, `compute_route_fee` | `set_pair_min_amount`; cleared by `clear_pair_config` (`unregister_pair`) |
| `PairMaxAmount` | `i128` | persistent | **Config** | `i128::MAX` (no ceiling) | `get_pair_max_amount`, `get_pair_info`, `get_pair_info_ext`, `compute_route_fee` | `set_pair_max_amount`; cleared by `clear_pair_config` (`unregister_pair`) |
| `PairLiquidity` | `i128` | persistent | **Hot**ÔÇá | `0` (getters), `i128::MAX` (`compute_route_fee` only) | `get_pair_liquidity`, `get_pair_info`, `get_pair_info_ext`, `is_pair_active`, `compute_route_fee` | `set_pair_liquidity`, `compute_route_fee` (decrement); cleared by `clear_pair_config` (`unregister_pair`) |
| `PairLastRouteAt` | `u64` | persistent | **Hot** | `None` (`Option`); `0` in `get_pair_info`/`get_pair_info_ext` | `get_pair_last_route_at`, `get_pair_info`, `get_pair_info_ext`, `compute_route_fee` (cooldown check) | `compute_route_fee`; removed by `purge_pair_metrics` |
| `PairRouteCount` | `u64` | persistent | **Hot** | `0` | `get_pair_route_count`, `get_pair_info_ext` | `compute_route_fee` (saturating `+1`); removed by `purge_pair_metrics` |
| `PairVolume` | `i128` | persistent | **Hot** | `0` | `get_pair_volume`, `get_pair_info_ext` | `compute_route_fee` (saturating `+amount`); removed by `purge_pair_metrics` |
| `PairCooldown` | `u64` | persistent | **Config** | `0` (disabled) | `get_pair_cooldown`, `get_pair_info_ext`, `compute_route_fee` (rate-limit gate) | `set_pair_cooldown`; cleared by `clear_pair_config` (`unregister_pair`) |

ÔÇá **Liquidity default is context-dependent.** `get_pair_liquidity`,
`get_pair_info`, `get_pair_info_ext`, and `is_pair_active` treat an absent
slot as `0`. But `compute_route_fee` reads it with `unwrap_or(i128::MAX)` ÔÇö
i.e. an unconfigured pair is treated as having *unbounded* liquidity for
routing. Set an explicit liquidity value to enforce the
`InsufficientLiquidity` (#12) guard.

## Clear-on-unregister slots

`unregister_pair` removes `Pair` and calls `clear_pair_config`, which
removes these per-pair config slots so that re-registering the same corridor
starts from documented defaults:

- `PairFeeBps`
- `PairMinAmount`
- `PairMaxAmount`
- `PairLiquidity`
- `PairCooldown`

These operational-history slots are **deliberately preserved** across
unregister/re-register cycles:

- `PairLastRouteAt`
- `PairRouteCount`
- `PairVolume`

Use `purge_pair_metrics` as an explicit, opt-in way to discard a pair's
lifetime history.

## `compute_route_fee` write summary

On every successful route, the following slots are written (extending their
persistent TTL):

| Slot | Operation | Guard |
|------|-----------|-------|
| `ReentrancyLock` | `true` ÔåÆ ÔÇª ÔåÆ `false` | non-reentrant gate |
| `TotalRoutesAllTime` | `saturating_add(1)` | protocol-wide |
| `PairRouteCount` | `saturating_add(1)` | per-pair |
| `PairVolume` | `saturating_add(amount)` | per-pair |
| `PairLastRouteAt` | `env.ledger().timestamp()` | per-pair |
| `PairLiquidity` | `saturating_sub(amount)` | **only when set** (Ôëá `i128::MAX`) |

## Versioning

`version()` returns the compiled contract version (`ROUTER_V2`);
`get_schema_version()` returns the persisted storage-layout version
(defaults to `1`, advanced to `2` by `migrate_v1_to_v2`). The two are
independent ÔÇö see the migration entrypoints in `src/lib.rs`.
