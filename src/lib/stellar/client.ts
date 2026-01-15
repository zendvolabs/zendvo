import { Horizon } from "@stellar/stellar-sdk";

/**
 * Basic Stellar client configuration.
 * In a real scenario, this would handle Horizon server connections
 * and Soroban contract interactions.
 */
export const stellarClient = new Horizon.Server(
  "https://horizon-testnet.stellar.org"
);

export const getGiftContractId = () =>
  process.env.NEXT_PUBLIC_STELLAR_CONTRACT_ID;
