import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  DEFAULT_SLIPPAGE_BPS,
  DefindexServiceError,
  MAX_SLIPPAGE_BPS,
  defindexService,
} from "@/lib/services/defindex_service";

/**
 * POST /api/wallet/withdraw
 *
 * Builds an unsigned, simulated Soroban transaction that burns the caller's
 * vault shares and returns the underlying savings to `address`.
 *
 * The route is protected by `validateRequestSignature` (see routes.ts), so the
 * caller must prove ownership of their registered Stellar key by signing
 * `timestamp:METHOD:path:sha256(body)`.
 *
 * Body:
 *   amount              string | number  Amount of the vault asset to withdraw
 *   address             string           Stellar public key that receives funds
 *   accountId           string           Alias for `address` (legacy client)
 *   slippageTolerance   number           Optional, percent (0–50, default 1)
 *   slippageBps         number           Optional, basis points (0–5000)
 */
const withdrawSchema = z
  .object({
    amount: z.union([z.string(), z.number()]),
    address: z.string().trim().min(1).optional(),
    accountId: z.string().trim().min(1).optional(),
    slippageTolerance: z.number().finite().min(0).max(50).optional(),
    slippageBps: z.number().int().min(0).max(MAX_SLIPPAGE_BPS).optional(),
  })
  .refine((data) => Boolean(data.address || data.accountId), {
    message: "address is required",
    path: ["address"],
  });

function resolveSlippageBps(data: {
  slippageTolerance?: number;
  slippageBps?: number;
}): number {
  if (data.slippageBps !== undefined) return data.slippageBps;
  if (data.slippageTolerance !== undefined) {
    return Math.round(data.slippageTolerance * 100);
  }
  return DEFAULT_SLIPPAGE_BPS;
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Unauthorized",
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Request body must be valid JSON",
      );
    }

    const parsed = withdrawSchema.safeParse(body);
    if (!parsed.success) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        parsed.error.issues[0]?.message ?? "Invalid input data",
      );
    }

    const { amount } = parsed.data;
    const address = parsed.data.address ?? parsed.data.accountId ?? "";
    const slippageBps = resolveSlippageBps(parsed.data);

    if (!StrKey.isValidEd25519PublicKey(address)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "address must be a valid Stellar public key",
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
      columns: {
        id: true,
        stellarAddress: true,
        vaultContractId: true,
      },
    });

    if (!user) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "User not found",
      );
    }

    if (!user.stellarAddress || user.stellarAddress !== address) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "address does not match the Stellar address registered to this account",
      );
    }

    const vaultContractId =
      user.vaultContractId ||
      process.env.DEFINDEX_VAULT_CONTRACT_ID ||
      process.env.SOROBAN_VAULT_CONTRACT_ID;

    if (!vaultContractId || !StrKey.isValidContract(vaultContractId)) {
      return createProblemDetails(
        "about:blank",
        "Service Unavailable",
        503,
        "Savings vault contract is not configured",
      );
    }

    const withdrawal = await defindexService.buildWithdrawalXdr({
      vaultContractId,
      userAddress: address,
      amount,
      slippageBps,
    });

    return NextResponse.json(
      {
        success: true,
        // `unsignedxdr` is kept for existing mobile clients; `unsignedXdr`
        // matches the naming used by the other Soroban endpoints.
        unsignedXdr: withdrawal.unsignedXdr,
        unsignedxdr: withdrawal.unsignedXdr,
        vaultContractId: withdrawal.vaultContractId,
        network: withdrawal.network,
        simulated: withdrawal.simulated,
        amountStroops: withdrawal.amountStroops.toString(),
        sharesToBurn: withdrawal.sharesToBurn.toString(),
        minAmountsOut: withdrawal.minAmountsOut.map((value) => value.toString()),
        sharePrice: withdrawal.sharePrice,
        slippageBps: withdrawal.slippageBps,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof DefindexServiceError) {
      const title =
        error.status === 422
          ? "Unprocessable Entity"
          : error.status === 503
            ? "Service Unavailable"
            : error.status === 400
              ? "Bad Request"
              : "Bad Gateway";

      return createProblemDetails(
        "about:blank",
        title,
        error.status,
        error.message,
        undefined,
        { code: error.code },
      );
    }

    console.error("[WALLET_WITHDRAW_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to build the withdrawal transaction",
    );
  }
}
