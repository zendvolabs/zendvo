use soroban_sdk::{contracttype, symbol_short, Address, Env};

/// Defined schema for the `Initialized` event emitted when a contract is initialized.
///
/// - **Topic**: `(symbol_short!("init"),)`
/// - **Data**: `Address` (the admin address)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializedEvent {
    pub admin: Address,
}

/// Emits the `Initialized` event when a contract is initialized.
///
/// # Arguments
/// * `env` - The Soroban environment.
/// * `admin` - The address of the admin set during initialization.
pub fn emit_initialized(env: &Env, admin: &Address) {
    env.events()
        .publish((symbol_short!("init"),), admin.clone());
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl, symbol_short,
        testutils::{Address as _, Events as _},
        vec, Address, Env, IntoVal,
    };

    #[contract]
    struct CoreEventTestContract;

    #[contractimpl]
    impl CoreEventTestContract {
        pub fn init(env: Env, admin: Address) {
            emit_initialized(&env, &admin);
        }
    }

    #[test]
    fn test_emit_initialized_event() {
        let env = Env::default();
        let contract_id = env.register(CoreEventTestContract, ());
        let admin = Address::generate(&env);

        CoreEventTestContractClient::new(&env, &contract_id).init(&admin);

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
}
