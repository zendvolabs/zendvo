use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _},
    token, vec, Address, Env, IntoVal,
};

use crate::gift::contract::{GiftContract, GiftContractClient, MAX_LOCK_DURATION_SECONDS};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Register the USDC test-token and return its address.
///
/// Minting is done via `token::StellarAssetClient` which exposes the
/// admin-only `mint` function — the correct API for soroban-sdk 22.x.
fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

/// Bootstrap a fresh environment with a deployed GiftContract, an admin, a
/// USDC token, a sender with `mint_amount` tokens, and a recipient.
#[allow(dead_code)]
struct TestFixture<'a> {
    env: Env,
    contract_id: Address,
    client: GiftContractClient<'a>,
    token_id: Address,
    admin: Address,
    sender: Address,
    recipient: Address,
}

impl<'a> TestFixture<'a> {
    fn setup(mint_amount: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        let token_id = create_token(&env, &admin);

        // Mint tokens to the sender via the StellarAssetClient (admin-only mint).
        let asset_client = token::StellarAssetClient::new(&env, &token_id);
        asset_client.mint(&sender, &mint_amount);

        let contract_id = env.register(GiftContract, ());
        let client = GiftContractClient::new(&env, &contract_id);

        client.initialize(&admin, &token_id);

        Self {
            env,
            contract_id,
            client,
            token_id,
            admin,
            sender,
            recipient,
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Initializing the contract emits an `Initialized` event with the admin address.
#[test]
fn test_initialize_emits_initialized_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_id = Address::generate(&env);

    let contract_id = env.register(GiftContract, ());
    let client = GiftContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token_id);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                contract_id,
                (symbol_short!("init"),).into_val(&env),
                admin.into_val(&env),
            )
        ]
    );
}

/// Happy path: unlock_time exactly at the maximum allowed boundary should succeed.
#[test]
fn test_create_gift_at_max_boundary_succeeds() {
    let f = TestFixture::setup(1_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + MAX_LOCK_DURATION_SECONDS; // exactly at cap

    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &500_000, &unlock_time);

    assert_eq!(gift_id, 1, "first gift should receive id=1");
}

/// Happy path: unlock_time well within the cap.
#[test]
fn test_create_gift_normal_unlock_succeeds() {
    let f = TestFixture::setup(1_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let one_year: u64 = 365 * 24 * 60 * 60;
    let unlock_time = ledger_now + one_year;

    let gift_id = f
        .client
        .create_gift(&f.sender, &f.recipient, &100_000, &unlock_time);

    assert_eq!(gift_id, 1);
}

/// Sad path: unlock_time one second beyond the cap must panic.
#[test]
#[should_panic]
fn test_create_gift_beyond_cap_panics() {
    let f = TestFixture::setup(1_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let over_cap = ledger_now + MAX_LOCK_DURATION_SECONDS + 1;

    f.client
        .create_gift(&f.sender, &f.recipient, &500_000, &over_cap);
}

/// Sad path: astronomical timestamp (simulating a front-end ms-instead-of-s
/// bug) must also be rejected.
#[test]
#[should_panic]
fn test_create_gift_astronomical_timestamp_panics() {
    let f = TestFixture::setup(1_000_000);

    // Simulate a front-end bug: Unix ms timestamp used instead of seconds
    // (~year 33,658 equivalent).
    let astronomical: u64 = 1_000_000_000_000;

    f.client
        .create_gift(&f.sender, &f.recipient, &500_000, &astronomical);
}

/// Sad path: zero amount must panic.
#[test]
#[should_panic]
fn test_create_gift_zero_amount_panics() {
    let f = TestFixture::setup(1_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 1000;

    f.client
        .create_gift(&f.sender, &f.recipient, &0, &unlock_time);
}

/// The gift counter increments correctly across multiple gifts.
#[test]
fn test_gift_ids_are_sequential() {
    let f = TestFixture::setup(3_000_000);

    let ledger_now: u64 = f.env.ledger().timestamp();
    let unlock_time = ledger_now + 3600;

    let id1 = f
        .client
        .create_gift(&f.sender, &f.recipient, &100_000, &unlock_time);
    let id2 = f
        .client
        .create_gift(&f.sender, &f.recipient, &200_000, &unlock_time);
    let id3 = f
        .client
        .create_gift(&f.sender, &f.recipient, &300_000, &unlock_time);

    assert_eq!((id1, id2, id3), (1, 2, 3));
}
