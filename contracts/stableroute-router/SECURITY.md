# Security Policy

This document describes the trust model, known limitations, and
responsible-disclosure process for the **StableRoute router**
([`src/lib.rs`](src/lib.rs)). It is grounded in the actual on-chain
surfaces of the contract; the `RouterError` enum and entrypoints in
[`src/lib.rs`](src/lib.rs) are the source of truth for error codes and
auth requirements.

## Trust model

The router today is a **routing-metadata and fee-quoting contract**. It
holds governance power but, by design, **does not custody or move funds**.

### Roles

- **Admin** (`DataKey::Admin`) ÔÇö the single privileged role. Set once via
  `init` and required (`require_admin`) by every state-changing
  governance entrypoint: `register_pair` / `unregister_pair`,
  `set_pair_fee_bps`, `set_pair_min_amount` / `set_pair_max_amount`,
  `set_pair_liquidity`, `set_fee_recipient`, `pause` / `unpause`,
  `migrate_v1_to_v2`, and the admin-handover flow.
- **Pending admin** (`DataKey::PendingAdmin`) ÔÇö the proposed next admin in
  the **two-step handover** (`propose_admin_transfer` ÔåÆ
  `accept_admin_transfer`). The two-step design prevents locking the
  contract out by handing control to an address that cannot sign.

### Emergency stop

`pause` sets `DataKey::Paused`; while paused, state-mutating entrypoints
panic with `ContractPaused` (#9). This is the operator's first response to
a discovered vulnerability.

### Checks before effects

`compute_route_fee` keeps route validation ahead of business effects:
registration, amount bounds, liquidity sufficiency, and per-pair cooldown
must all pass before liquidity is debited, counters or timestamps are
updated, or `liq_used` / `route` events are emitted. A rejected route must
therefore leave observable route state unchanged.

### Assumptions

- The admin key is honest and uncompromised. A compromised admin can set
  fees up to `MAX_FEE_BPS` (10%), redirect the fee recipient, pause the
  router, and rotate admin.
- Liquidity values (`PairLiquidity`) reflect an off-chain oracle's view
  and are trusted as reported; the contract does not independently verify
  them.
- Fee math (`compute_route_fee` / `quote_route`) is integer division
  truncating toward zero and is bounded so `fee <= amount`.

## Known limitations

- **No fund movement yet.** The router quotes and records routes; it does
  not custody, transfer, or settle value on-chain. Fee "collection" is an
  off-chain responsibility of the integrator.
- **Instant configuration changes.** Fee, recipient, liquidity, and
  admin-handover changes take effect as soon as they are authorized ÔÇö
  there is no built-in timelock or delay on the base contract.
- **No storage TTL bumping.** Persistent entries are not proactively
  extended; long-idle pairs may require a write to refresh their TTL.
- **Single admin key.** All governance authority is concentrated in one
  address; there is no multisig or role separation in the base contract.
- **Oracle-trusted liquidity.** `set_pair_liquidity` accepts whatever the
  authorized caller reports.

## Error-code stability

`RouterError` codes are **append-only**: a variant is never reused or
renumbered once shipped. Clients can rely on `Error(Contract, #N)` codes
remaining stable across upgrades and only need to learn about new, higher
codes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security-sensitive
reports.** Instead, use coordinated disclosure:

1. Report privately via the **StableRoute Discord** ÔÇö
   <https://discord.gg/37aCpusvx> ÔÇö and request a maintainer for security
   coordination.
2. Include: affected entrypoint(s)/`DataKey`(s), a description of the
   issue, reproduction steps or a PoC, and the impact you observed.
3. Please allow a reasonable window for a fix before any public
   disclosure. We will acknowledge your report, work on a remediation,
   and credit you (if desired) once a fix has shipped.

Thank you for helping keep StableRoute and its users safe.
