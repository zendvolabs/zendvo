# StableRoute Router ÔÇö Entrypoint & Event Reference

Authoritative on-chain ABI for `StableRouteRouter` ([`src/lib.rs`](../src/lib.rs)).
Every public entrypoint and emitted event is listed below, grouped by
subsystem. Error codes referenced here are documented in the
`RouterError` table in the [README](../README.md).

**Auth legend:** _admin_ = `require_admin` (the stored `Admin` must sign) ┬À
_pending_ = the proposed pending admin must sign ┬À _none_ = no auth.

## Lifecycle

| Entrypoint | Auth | Params | Returns | Errors | Event |
|-----------|------|--------|---------|--------|-------|
| `init` | admin | `admin: Address` | ÔÇö | `AlreadyInitialized` (#1) | `init(admin)` |
| `version` | none | ÔÇö | `Symbol` (`ROUTER_V2`) | ÔÇö | ÔÇö |
| `get_schema_version` | none | ÔÇö | `u32` | ÔÇö | ÔÇö |
| `migrate_v1_to_v2` | admin | ÔÇö | ÔÇö | `NotInitialized` (#2), `MigrationVersionMismatch` (#13) | ÔÇö |

## Admin / governance

| Entrypoint | Auth | Params | Returns | Errors | Event |
|-----------|------|--------|---------|--------|-------|
| `get_admin` | none | ÔÇö | `Option<Address>` | ÔÇö | ÔÇö |
| `propose_admin_transfer` | admin | `new_admin: Address` | ÔÇö | `NotInitialized` (#2) | `adm_prop(new_admin)` |
| `accept_admin_transfer` | pending | `caller: Address` | ÔÇö | `NoPendingAdminTransfer` (#7), `NotPendingAdmin` (#8) | `adm_set(caller)` |
| `cancel_admin_transfer` | admin | ÔÇö | ÔÇö | `NotInitialized` (#2) | ÔÇö |
| `get_pending_admin` | none | ÔÇö | `Option<Address>` | ÔÇö | ÔÇö |

## Pause (emergency stop)

| Entrypoint | Auth | Params | Returns | Errors | Event |
|-----------|------|--------|---------|--------|-------|
| `pause` | admin | ÔÇö | ÔÇö | `NotInitialized` (#2) | `paused(true)` |
| `unpause` | admin | ÔÇö | ÔÇö | `NotInitialized` (#2) | `paused(false)` |
| `is_paused` | none | ÔÇö | `bool` | ÔÇö | ÔÇö |

## Pairs

| Entrypoint | Auth | Params | Returns | Errors | Event |
|-----------|------|--------|---------|--------|-------|
| `register_pair` | admin | `source: Symbol, destination: Symbol` | ÔÇö | `ContractPaused` (#9), `NotInitialized` (#2), `SourceEqualsDestination` (#3) | `pair_reg(source, destination)` |
| `register_pairs` | admin | `pairs: Vec<(Symbol, Symbol)>` | ÔÇö | `ContractPaused` (#9), `NotInitialized` (#2), `EmptyBatch` (#19), `BatchTooLarge` (#18), `SourceEqualsDestination` (#3) | `pair_reg(source, destination)` per entry |
| `unregister_pair` | admin | `source: Symbol, destination: Symbol` | ÔÇö | `NotInitialized` (#2) | `unreg(source, destination)` |
| `is_pair_registered` | none | `source: Symbol, destination: Symbol` | `bool` | ÔÇö | ÔÇö |
| `is_pair_active` | none | `source: Symbol, destination: Symbol` | `bool` | ÔÇö | ÔÇö |
| `get_pair_info` | none | `source: Symbol, destination: Symbol` | `PairInfo` | ÔÇö | ÔÇö |
| `get_pair_info_ext` | none | `source: Symbol, destination: Symbol` | `PairInfoExt` | ÔÇö | ÔÇö |

## Fees

| Entrypoint | Auth | Params | Returns | Errors | Event |
|-----------|------|--------|---------|--------|-------|
| `set_pair_fee_bps` | admin | `source: Symbol, destination: Symbol, fee_bps: u32` | ÔÇö | `ContractPaused` (#9), `NotInitialized` (#2), `FeeBpsTooHigh` (#4) | `fee_set(source, destination, fee_bps)` |
| `set_pair_fees_bps` | admin | `entries: Vec<(Symbol, Symbol, u32)>` | ÔÇö | `ContractPaused` (#9), `NotInitialized` (#2), `EmptyBatch` (#19), `BatchTooLarge` (#18), `FeeBpsTooHigh` (#4), `PairNotRegistered` (#5) | `fee_set(source, destination, fee_bps)` per entry |
| `get_pair_fee_bps` | none | `source: Symbol, destination: Symbol` | `u32` | ÔÇö | ÔÇö |
| `set_fee_recipient` | admin | `recipient: Address` | ÔÇö | `NotInitialized` (#2) | ÔÇö |
| `get_fee_recipient` | none | ÔÇö | `Option<Address>` | ÔÇö | ÔÇö |

## Bounds & liquidity

| Entrypoint | Auth | Params | Returns | Errors | Event |
|-----------|------|--------|---------|--------|-------|
| `set_pair_min_amount` | admin | `source, destination: Symbol, min_amount: i128` | ÔÇö | `NotInitialized` (#2), `AmountMustBePositive` (#6) | ÔÇö |
| `get_pair_min_amount` | none | `source, destination: Symbol` | `i128` | ÔÇö | ÔÇö |
| `set_pair_max_amount` | admin | `source, destination: Symbol, max_amount: i128` | ÔÇö | `NotInitialized` (#2), `AmountMustBePositive` (#6) | ÔÇö |
| `get_pair_max_amount` | none | `source, destination: Symbol` | `i128` | ÔÇö | ÔÇö |
| `set_pair_liquidity` | admin | `source, destination: Symbol, liquidity: i128` | ÔÇö | `NotInitialized` (#2), `AmountMustBePositive` (#6) | `liq_set(source, destination, liquidity)` |
| `get_pair_liquidity` | none | `source, destination: Symbol` | `i128` | ÔÇö | ÔÇö |

## Routing

| Entrypoint | Auth | Params | Returns | Errors | Event |
|-----------|------|--------|---------|--------|-------|
| `compute_route_fee` | none | `source, destination: Symbol, amount: i128` | `i128` (fee) | `AmountMustBePositive` (#6), `PairNotRegistered` (#5), `AmountBelowMin` (#10), `AmountAboveMax` (#11), `InsufficientLiquidity` (#12) | `route(source, destination, amount)` |
| `quote_route` | none | `source, destination: Symbol, amount: i128` | `(i128 fee, i128 net)` | `AmountMustBePositive` (#6), `PairNotRegistered` (#5) | ÔÇö |
| `get_pair_last_route_at` | none | `source, destination: Symbol` | `Option<u64>` | ÔÇö | ÔÇö |
| `get_total_routes_all_time` | none | ÔÇö | `u64` | ÔÇö | ÔÇö |
| `route_tag` | none | `source, destination: Symbol` | `(Symbol, Symbol)` | ÔÇö | ÔÇö |

## Event catalog

Every event is published with a single `symbol_short!` topic and a data
payload tuple. Topic symbols are capped at 9 characters.

| Topic | Payload | Emitted by |
|-------|---------|-----------|
| `init` | `admin: Address` | `init` |
| `adm_prop` | `new_admin: Address` | `propose_admin_transfer` |
| `adm_set` | `caller: Address` | `accept_admin_transfer` |
| `paused` | `bool` | `pause` / `unpause` |
| `pair_reg` | `(source, destination): (Symbol, Symbol)` | `register_pair` |
| `unreg` | `(source, destination): (Symbol, Symbol)` | `unregister_pair` |
| `cfg_clr` | `(source, destination): (Symbol, Symbol)` | `unregister_pair` |
| `fee_set` | `(source, destination, fee_bps): (Symbol, Symbol, u32)` | `set_pair_fee_bps` |
| `liq_set` | `(source, destination, liquidity): (Symbol, Symbol, i128)` | `set_pair_liquidity` |
| `route` | `(source, destination, amount): (Symbol, Symbol, i128)` | `compute_route_fee` |

## Extended pair info (`PairInfoExt`)

Added in a later batch after the original `PairInfo`, `get_pair_info_ext`
returns all per-pair slots in a single round-trip. The extra fields beyond
`PairInfo` are:

| Field | Type | Default | Source slot |
|-------|------|---------|-------------|
| `cooldown_secs` | `u64` | `0` (disabled) | `PairCooldown` |
| `route_count` | `u64` | `0` | `PairRouteCount` |
| `volume` | `i128` | `0` | `PairVolume` |

> Keep this catalog in sync with the `symbol_short!(...)` calls in
> `src/lib.rs` whenever an entrypoint or event is added or changed.
