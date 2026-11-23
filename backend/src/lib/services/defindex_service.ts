import { DefindexSDK, SupportedNetworks } from "@defindex/sdk";

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

  const result = response as typeof response & {
    fee?: string | number;
    resourceFee?: string | number;
    simulation?: unknown;
    transactionData?: { resourceFee?: string | number };
  };
  if (!result.xdr) {
    throw new Error("DeFindex did not return an unsigned deposit transaction XDR");
  }
  return {
    xdr: result.xdr,
    fee: result.fee == null ? null : String(result.fee),
    resourceFee: result.resourceFee == null && result.transactionData?.resourceFee == null
      ? null
      : String(result.resourceFee ?? result.transactionData?.resourceFee),
    simulation: result.simulation ?? null,
  };
}
