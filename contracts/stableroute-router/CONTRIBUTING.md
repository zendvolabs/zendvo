# Contributing to stableroute-contracts

Thanks for contributing to the StableRoute Soroban contracts. This guide
documents the conventions the `StableRouteRouter` contract relies on. Every
rule below is enforced by the code in `src/lib.rs` and by CI, so following
them keeps reviews fast and avoids breaking on-chain compatibility.

Questions or want to coordinate? Join the StableRoute Discord:
<https://discord.gg/37aCpusvx>

## Error codes are append-only

`RouterError` is a `#[contracterror]` enum with an explicit `#[repr(u32)]`
discriminant on every variant. These codes are part of the contract's
on-chain ABI: off-chain clients and existing deployments depend on a given
number meaning a given error forever.

Rules:

- **Never reuse a code.** If a variant is removed, its number is retired,
  not recycled.
- **Never renumber a shipped variant.** Changing `ContractPaused = 9` to a
  different number silently breaks every caller that matches on `#9`.
- **New errors get the next free code.** The enum currently goes up to
  `MigrationVersionMismatch = 13`, so the next new variant must be `= 14`.

```rust
// in `enum RouterError`
SomethingNew = 14, // <- next free code
```

Add `///` doc on the new variant describing exactly when it is raised.

## Event topics must fit `symbol_short!` (<= 9 characters)

Events are published with a `symbol_short!` topic. `symbol_short!` only
accepts symbols of **9 characters or fewer**; a longer literal will not
compile. Choose a short, abbreviated topic name.

Existing topics follow this convention:

- `pair_reg` ÔÇö `register_pair`
- `fee_set` ÔÇö `set_pair_fee_bps`
- `adm_prop` ÔÇö `propose_admin_transfer`
- `route` ÔÇö `compute_route_fee`

Other live examples: `init`, `paused`, `adm_set`, `liq_set`, `unreg`. When
in doubt, abbreviate (`liq_set`, not `liquidity_set`).

## Admin-auth pattern

Every admin-gated entrypoint must start its body with:

```rust
Self::require_admin(&env);
```

`require_admin` loads `DataKey::Admin` from persistent storage, panics with
`RouterError::NotInitialized` (`#2`) if it is absent, then calls
`admin.require_auth()` and returns the admin address. Do **not** re-implement
the load-unwrap-require_auth block inline ÔÇö always call the helper so auth
behaviour stays uniform and the helper never leaks into the generated client
ABI (it is private).

## Pause-gate pattern

State-changing entrypoints that should be blocked while the router is paused
must check the pause flag **before** doing any work and panic with
`RouterError::ContractPaused` (`#9`):

```rust
if env
    .storage()
    .persistent()
    .get(&DataKey::Paused)
    .unwrap_or(false)
{
    panic_with_error!(&env, RouterError::ContractPaused);
}
Self::require_admin(&env);
```

See `register_pair` and `set_pair_fee_bps` for the canonical placement
(pause check first, then `require_admin`).

## Storage tiers and TTL

- **Persistent storage** holds the admin address and all per-pair
  configuration (registration, fee bps, min/max amounts, liquidity, last
  route timestamp, schema version, fee recipient). These change rarely and
  must survive the contract's instance TTL window.
- **Instance storage** is reserved for hot configuration that every
  invocation is expected to touch. There is none today; do not move
  per-pair data into instance storage.
- **Bump the TTL on new slots when you write them.** Adding a new
  persistent slot means it can expire; extend its TTL on write so it lives
  as long as the rest of the contract state. Mirror the storage tier choice
  documented on the `DataKey` enum in `src/lib.rs`.

When adding a new storage key, add it to the `DataKey` enum with a `///`
comment explaining its tier rationale, matching the existing entries.

## Local workflow

Run these before opening a PR (they mirror CI):

```bash
cargo fmt --all -- --check
cargo build
cargo test
```

`cargo fmt --all` will auto-fix formatting; the `--check` form only reports.
The full CI matrix (clippy, WASM build, coverage) is listed in the README.

## PR checklist

Before requesting review, confirm:

- [ ] Tests added for new behaviour (happy path **and** error paths).
- [ ] NatSpec-style `///` doc comments on every new public entrypoint.
- [ ] No error codes renumbered or reused; new errors use the next free code.
- [ ] Events asserted in tests where an entrypoint publishes one.
- [ ] Docs updated (this file and/or the README) when conventions change.
- [ ] `cargo fmt --all -- --check`, `cargo build`, and `cargo test` all pass.
