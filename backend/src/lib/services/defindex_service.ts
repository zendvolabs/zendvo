import { DefindexSDK, SupportedNetworks } from "@defindex/sdk";
import { Networks, rpc, TransactionBuilder } from "@stellar/stellar-sdk";

export interface DepositTransaction {
  xdr: string;
  fee: string | null;
  resourceFee: string | null;
  simulation: unknown;
}

/** Builds and simulates an unsigned DeFindex vault deposit transaction. */
export async function buildDepositTransaction(options: {
  vaultAddress: string;
  caller: string;
  amount: bigint;
}): Promise<DepositTransaction> {
  const apiKey = process.env.DEFINDEX_API_KEY;
  if (!apiKey) throw new Error("DeFindex API key is not configured");

  const network = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
  const supportedNetwork = network === "mainnet"
    ? SupportedNetworks.MAINNET
    : SupportedNetworks.TESTNET;
  const sdk = new DefindexSDK({
    apiKey,
    ...(process.env.DEFINDEX_API_URL ? { baseUrl: process.env.DEFINDEX_API_URL } : {}),
  });

  const response = await sdk.depositToVault(
    options.vaultAddress,
    {
      amounts: [Number(options.amount)],
      caller: options.caller,
      invest: true,
      slippageBps: Number(process.env.DEFINDEX_DEPOSIT_SLIPPAGE_BPS || 100),
    },
    supportedNetwork,
  );

  const result = response;
  if (!result.xdr) {
    throw new Error("DeFindex did not return an unsigned deposit transaction XDR");
  }
  const networkPassphrase = network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
  const rpcUrl = process.env.SOROBAN_RPC_URL || process.env.STELLAR_RPC_URL;
  if (!rpcUrl) throw new Error("SOROBAN_RPC_URL or STELLAR_RPC_URL must be configured");

  const transaction = TransactionBuilder.fromXDR(result.xdr, networkPassphrase);
  const simulation = await new rpc.Server(rpcUrl).simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Soroban deposit simulation failed: ${simulation.error}`);
  }
  return {
    xdr: result.xdr,
    fee: transaction.fee,
    resourceFee: simulation.minResourceFee ?? null,
    simulation: result.simulationResponse ?? null,
  };
}
