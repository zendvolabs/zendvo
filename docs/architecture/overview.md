# Architecture Overview

Zendvo is a full-stack Next.js application that leverages the Stellar blockchain for trustless time-locked financial operations.

## Layered Architecture

### 1. Frontend Layer (`src/app`)
- **App Router**: Uses Next.js App Router for server-side rendering and routing.
- **Client Components**: Interactive gifting interfaces and dashboards.
- **Vanilla CSS**: Premium, lightweight styling for fast performance.

### 2. Service Layer (`src/server/services`)
- **Gift Orchestration**: Manages the lifecycle of a gift from creation to unlock.
- **Scheduling**: Handles the notification and unlock triggers.
- **Blockchain Interface**: Communicates with Stellar Soroban smart contracts.

### 3. Data Layer
- **PostgreSQL & Drizzle**: Stores user profiles, gift metadata, and transaction history.
- **Stellar Soroban**: The source of truth for fund custody and time-lock guarantees.

## Financial Flow
1. **Sender** creates a gift and pays via Stripe/Paystack or USDC.
2. Funds are deposited into a **Soroban Smart Contract**.
3. The contract is configured with a **Time-Lock** that prevents any withdrawal before the unlock date.
4. **Recipient** receives a notification and can only "claim" the gift after the time-lock expires.
5. Funds are released from the contract directly to the recipient's wallet or converted to local fiat.
