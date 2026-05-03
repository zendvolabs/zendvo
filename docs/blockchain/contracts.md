# Smart Contract Logic

Zendvo utilizes the Stellar Soroban smart contract platform for its core time-locking functionality.

## Core Contract Features

### 1. Time-Lock Escrow
The contract acts as a non-custodial escrow that accepts USDC deposits. Upon deposit, a `unlock_timestamp` is set.

### 2. Authorization
Only the designated `recipient_address` can claim the funds, and only after the `current_timestamp` is greater than or equal to the `unlock_timestamp`.

### 3. Immutable Guarantees
Once the funds are locked in the contract, neither Zendvo nor the Sender can withdraw them early. This ensures the gift remains "hidden" and "locked" as promised.

## Technical Implementation
- **Language**: Rust
- **Platform**: Stellar Soroban
- **Status**: Deployment on Testnet/Mainnet
