#![cfg(test)]

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _},
    token, Address, Env, TryIntoVal,
};

use crate::core::errors::ContractError;
use crate::savings::contract::{SavingsContract, SavingsContractClient};
use crate::savings::types::{DataKey, UserSavings};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

fn seed_savings(
    env: &Env,
    contract_id: &Address,
    user: &Address,
    principal: i128,
    yield_shares: i128,
) {
    let record = UserSavings {
        principal,
        yield_shares,
    };
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::UserSavingsRecord(user.clone()), &record);
    });
}

// ── Fixture ───────────────────────────────────────────────────────────────────

#[allow(dead_code)]
struct TestFixture<'a> {
    env: Env,
    contract_id: Address,
    client: SavingsContractClient<'a>,
    token_id: Address,
    admin: Address,
    user: Address,
}

impl<'a> TestFixture<'a> {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let token_id = create_token(&env, &admin);

        // Mint a pool of USDC to the token admin so the contract can later
        // receive yield-bearing balances.
        let asset_client = token::StellarAssetClient::new(&env, &token_id);
        asset_client.mint(&token_id, &1_000_000_000);

        // Deploy with constructor — TokenAddress is set atomically.
        let contract_id = env.register(SavingsContract, (token_id.clone(),));
        let client = SavingsContractClient::new(&env, &contract_id);

        // Mint USDC to the contract to simulate prior yield accrual.
        asset_client.mint(&contract_id, &1_000_000_000);

        Self {
            env,
            contract_id,
            client,
            token_id,
            admin,
            user,
        }
    }
}

// ── Constructor tests ─────────────────────────────────────────────────────────

#[test]
fn test_constructor_stores_token_address() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_id = create_token(&env, &admin);
    let contract_id = env.register(SavingsContract, (token_id.clone(),));

    let stored: Address = env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .unwrap()
    });
    assert_eq!(stored, token_id);
}

// ── claim_yield tests ─────────────────────────────────────────────────────────

#[test]
fn test_claim_yield_succeeds() {
    let f = TestFixture::setup();
    seed_savings(&f.env, &f.contract_id, &f.user, 10_000, 500);

    let token_client = token::Client::new(&f.env, &f.token_id);
    let balance_before = token_client.balance(&f.user);

    f.client.claim_yield(&f.user);

    let balance_after = token_client.balance(&f.user);
    assert_eq!(balance_after - balance_before, 500);
}

#[test]
fn test_claim_yield_preserves_principal() {
    let f = TestFixture::setup();
    seed_savings(&f.env, &f.contract_id, &f.user, 10_000, 500);

    f.client.claim_yield(&f.user);

    let record: UserSavings = f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get(&DataKey::UserSavingsRecord(f.user.clone()))
            .unwrap()
    });
    assert_eq!(record.principal, 10_000);
}

#[test]
fn test_claim_yield_resets_yield_to_zero() {
    let f = TestFixture::setup();
    seed_savings(&f.env, &f.contract_id, &f.user, 10_000, 500);

    f.client.claim_yield(&f.user);

    let record: UserSavings = f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get(&DataKey::UserSavingsRecord(f.user.clone()))
            .unwrap()
    });
    assert_eq!(record.yield_shares, 0);
}

#[test]
fn test_second_claim_returns_no_yield() {
    let f = TestFixture::setup();
    seed_savings(&f.env, &f.contract_id, &f.user, 10_000, 500);

    f.client.claim_yield(&f.user);

    let result = f.client.try_claim_yield(&f.user);
    assert_eq!(result, Err(Ok(ContractError::NoYieldToClaim)));
}

#[test]
fn test_claim_yield_zero_yield_fails() {
    let f = TestFixture::setup();
    seed_savings(&f.env, &f.contract_id, &f.user, 10_000, 0);

    let result = f.client.try_claim_yield(&f.user);
    assert_eq!(result, Err(Ok(ContractError::NoYieldToClaim)));
}

#[test]
fn test_claim_yield_no_record_fails() {
    let f = TestFixture::setup();
    // user has no storage entry — get_user_savings defaults to yield_shares = 0

    let result = f.client.try_claim_yield(&f.user);
    assert_eq!(result, Err(Ok(ContractError::NoYieldToClaim)));
}

#[test]
fn test_claim_yield_rejects_unauthorized() {
    let env = Env::default();
    // No mock_all_auths — require_auth is not bypassed

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_id = create_token(&env, &admin);
    let contract_id = env.register(SavingsContract, (token_id.clone(),));
    let client = SavingsContractClient::new(&env, &contract_id);

    let result = client.try_claim_yield(&user);
    assert!(result.is_err());
}

#[test]
fn test_claim_yield_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_id = create_token(&env, &admin);
    let asset_client = token::StellarAssetClient::new(&env, &token_id);
    let contract_id = env.register(SavingsContract, (token_id.clone(),));
    let client = SavingsContractClient::new(&env, &contract_id);

    // Mint so token transfer in claim_yield doesn't fail.
    asset_client.mint(&contract_id, &1_000_000_000);
    seed_savings(&env, &contract_id, &user, 10_000, 500);

    // Claim yield and collect events.
    client.claim_yield(&user);
    let events = env.events().all();

    // Last event must be SavYld.
    let (contract, topics, data) = events.get(events.len() - 1).unwrap();
    assert_eq!(contract, contract_id);

    // Check first topic is "SavYld".
    let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic0, symbol_short!("SavYld"));

    // Check second topic is the user.
    let topic1: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic1, user.clone());

    // Check data is 500.
    let data_i128: i128 = data.try_into_val(&env).unwrap();
    assert_eq!(data_i128, 500i128);
}

#[test]
fn test_multi_user_isolation() {
    let f = TestFixture::setup();
    let user_b = Address::generate(&f.env);

    seed_savings(&f.env, &f.contract_id, &f.user, 10_000, 500);
    seed_savings(&f.env, &f.contract_id, &user_b, 20_000, 1000);

    let token_client = token::Client::new(&f.env, &f.token_id);
    let b_balance_before = token_client.balance(&user_b);

    // User A claims
    f.client.claim_yield(&f.user);

    // User B's record must be completely untouched
    let b_record: UserSavings = f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .get(&DataKey::UserSavingsRecord(user_b.clone()))
            .unwrap()
    });
    assert_eq!(b_record.yield_shares, 1000, "user_b yield_shares unchanged");
    assert_eq!(b_record.principal, 20_000, "user_b principal unchanged");

    // User B can still claim their own yield
    f.client.claim_yield(&user_b);
    assert_eq!(token_client.balance(&user_b), b_balance_before + 1000);
}

#[test]
fn test_claim_yield_insufficient_balance_rollback() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let token_id = create_token(&env, &admin);
    let contract_id = env.register(SavingsContract, (token_id.clone(),));
    let client = SavingsContractClient::new(&env, &contract_id);

    // Seed yield but do NOT mint any USDC to the contract
    seed_savings(&env, &contract_id, &user, 10_000, 500);

    // Attempt to claim — token transfer panics (insufficient balance)
    let result = client.try_claim_yield(&user);
    assert!(result.is_err(), "claim must fail when contract has no USDC");

    // Verify atomic rollback: yield_shares and principal are unchanged
    let saved: UserSavings = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get(&DataKey::UserSavingsRecord(user.clone()))
            .unwrap()
    });
    assert_eq!(
        saved.yield_shares, 500,
        "yield_shares rolled back after failed transfer"
    );
    assert_eq!(
        saved.principal, 10_000,
        "principal unchanged after failed transfer"
    );
}
