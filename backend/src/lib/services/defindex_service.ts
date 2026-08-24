/**
 * DeFindex Service
 *
 * Interfaces with the DeFindex API (via @defindex/sdk) to construct unsigned
 * Soroban XDR payloads for USDC vault deposits. The returned XDR must be
 * signed by the user's wallet before submission to the network.
 */
import { StrKey } from "@stellar/stellar-sdk";

/** Number of decimal places used by the Stellar/Soroban convention (1e7 stroops = 1 unit). */
const STROOPS_PER_UNIT = 10_000_000n;

export class DeFindexServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "DeFindexServiceError";
  }
}

/**
 * Converts a human-readable decimal amount string (e.g. "50.00") to the
 * integer stroop value required by the DeFindex vault contract (7 decimals).
 *
 * Throws if the input is not a valid positive decimal number.
 */
export function toStroops(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed) || Number(trimmed) <= 0) {
    throw new DeFindexServiceError(
      `Invalid deposit amount: "${amount}". Must be a positive number such as "50.00".`,
    );
  }

  const [whole, fraction = ""] = trimmed.split(".");
  // Pad or truncate fraction to exactly 7 decimal places
  const decimals = fraction.padEnd(7, "0").slice(0, 7);
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(decimals);
}

/**
 * Builds a fee-estimated, unsigned XDR for a DeFindex vault deposit.
 *
 * The DeFindex SDK handles:
 *  - Constructing the Soroban contract invocation with correct ScVal types
 *  - Simulating the transaction against the Soroban RPC
 *  - Applying resource fees from the simulation result
 *
 * The caller must sign the returned XDR before submitting it to the network.
 *
 * @param userAddress - Valid Stellar Ed25519 public key (G…) of the depositor.
 * @param amount      - Human-readable deposit amount, e.g. "50.00".
 * @returns           - Base64-encoded unsigned transaction XDR string.
 */
export async function buildDeFindexDepositXdr(
  userAddress: string,
  amount: string,
): Promise<string> {
  // --- Validate inputs ---
  if (!StrKey.isValidEd25519PublicKey(userAddress)) {
    throw new DeFindexServiceError(`Invalid Stellar address: "${userAddress}"`);
  }

  const stroops = toStroops(amount);

  // --- Read environment config ---
  const vaultAddress = process.env.DEFINDEX_VAULT_CONTRACT_ID;
  if (!vaultAddress || !StrKey.isValidContract(vaultAddress)) {
    throw new DeFindexServiceError(
      "DEFINDEX_VAULT_CONTRACT_ID is not configured or is not a valid contract address.",
    );
  }

  const apiKey = process.env.DEFINDEX_API_KEY;
  if (!apiKey) {
    throw new DeFindexServiceError("DEFINDEX_API_KEY is not configured.");
  }

  const baseUrl = process.env.DEFINDEX_API_URL || "https://api.defindex.io";
  const networkEnv = process.env.STELLAR_NETWORK || "TESTNET";

  // --- Dynamically import SDK to keep it server-side only ---
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DefindexSDK, SupportedNetworks } = await import("@defindex/sdk");

  const network =
    networkEnv === "MAINNET"
      ? SupportedNetworks.MAINNET
      : SupportedNetworks.TESTNET;

  const sdk = new DefindexSDK({ apiKey, baseUrl });

  // --- Call the DeFindex API to build the deposit XDR ---
  let response: { xdr: string };
  try {
    response = await sdk.depositToVault(
      vaultAddress,
      {
        // amounts: integer stroop values per vault asset (single USDC asset vault)
        amounts: [Number(stroops)],
        caller: userAddress,
        invest: true,
        slippageBps: 100, // 1% slippage tolerance
      },
      network,
    );
  } catch (err) {
    throw new DeFindexServiceError(
      `DeFindex API request failed: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  if (!response?.xdr) {
    throw new DeFindexServiceError(
      "DeFindex API returned an empty XDR payload.",
    );
  }

  return response.xdr;
}
