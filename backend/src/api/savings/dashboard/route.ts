import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { savingsHistory, users } from "@/lib/db/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  DefindexService,
  DefindexServiceError,
  type HistoricalSharePriceSnapshot,
} from "@/lib/services/defindex_service";

/**
 * GET /api/savings/dashboard
 *
 * Retrieves aggregated real-time savings dashboard data for the authenticated user,
 * including on-chain DeFindex vault balances, underlying USDC values, estimated APY,
 * and recent savings transactions.
 *
 * @param request - NextRequest containing the bearer authorization token and optional query parameters.
 * @returns NextResponse with the formatted savings dashboard data or RFC-7807 problem details.
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required",
      );
    }

    const { userId } = payload;

    // 2. Retrieve user and their registered Stellar address
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        id: true,
        stellarAddress: true,
        vaultContractId: true,
        savingsStatus: true,
        savingsBalance: true,
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

    if (!user.stellarAddress) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "No Stellar address registered for this account",
      );
    }

    const userAddress = user.stellarAddress.trim();

    // 3. Extract and validate vault contract ID
    const url = request.nextUrl ?? new URL(request.url);
    const requestedVaultId = url.searchParams.get("vaultContractId")?.trim();

    // Enforce that a caller cannot query a foreign vault if the account is bound to a registered vault
    if (requestedVaultId && user.vaultContractId && requestedVaultId !== user.vaultContractId) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Requested vault does not match the account's registered vault",
      );
    }

    const vaultContractId =
      requestedVaultId ||
      user.vaultContractId ||
      process.env.DEFINDEX_VAULT_CONTRACT_ID;

    const skipCache =
      url.searchParams.get("skipCache") === "true" ||
      url.searchParams.get("refresh") === "true";

    // 4. Retrieve historical deposit snapshot for APY calculation if available
    let historicalSnapshot: HistoricalSharePriceSnapshot | undefined;
    try {
      const [latestDeposit] = await db
        .select({
          sharePrice: savingsHistory.sharePrice,
          createdAt: savingsHistory.createdAt,
        })
        .from(savingsHistory)
        .where(
          and(
            eq(savingsHistory.userId, user.id),
            eq(savingsHistory.type, "deposit"),
            eq(savingsHistory.status, "completed"),
            isNotNull(savingsHistory.sharePrice),
            ...(vaultContractId ? [eq(savingsHistory.vaultContractId, vaultContractId)] : []),
          ),
        )
        .orderBy(desc(savingsHistory.createdAt))
        .limit(1);

      if (latestDeposit && latestDeposit.sharePrice && latestDeposit.sharePrice > 0) {
        historicalSnapshot = {
          timestamp: latestDeposit.createdAt,
          sharePrice: BigInt(Math.round(latestDeposit.sharePrice * 10_000_000)),
        };
      }
    } catch {
      // Historical lookup failure is non-fatal
    }

    // 5. Query DeFindex vault balance and yield data
    const vaultBalance = await DefindexService.getVaultBalance(
      userAddress,
      vaultContractId,
      {
        skipCache,
        historicalSnapshot,
      },
    );

    // 6. If historical APY calculation is unavailable, try SDK estimate
    let apyInfo = vaultBalance.apy;
    if (apyInfo.rate === null) {
      try {
        const sdkApy = await DefindexService.estimateApy(vaultBalance.contractId);
        if (typeof sdkApy.apy === "number" && !isNaN(sdkApy.apy)) {
          apyInfo = {
            rate: sdkApy.apy,
            formatted: `${(sdkApy.apy * 100).toFixed(2)}%`,
            isEstimated: true,
            methodology: "Vault APY estimated via DeFindex protocol SDK.",
          };
        }
      } catch {
        // Fall back to the APYInfo from getVaultBalance
      }
    }

    // 7. Retrieve recent savings history for dashboard display
    let recentTransactions: Array<{
      id: string;
      type: string;
      status: string;
      amount: number;
      currency: string;
      transactionHash: string | null;
      createdAt: Date;
    }> = [];

    try {
      recentTransactions = await db
        .select({
          id: savingsHistory.id,
          type: savingsHistory.type,
          status: savingsHistory.status,
          amount: savingsHistory.amount,
          currency: savingsHistory.currency,
          transactionHash: savingsHistory.transactionHash,
          createdAt: savingsHistory.createdAt,
        })
        .from(savingsHistory)
        .where(
          and(
            eq(savingsHistory.userId, user.id),
            ...(vaultContractId ? [eq(savingsHistory.vaultContractId, vaultContractId)] : []),
          ),
        )
        .orderBy(desc(savingsHistory.createdAt))
        .limit(5);
    } catch {
      recentTransactions = [];
    }

    // 8. Return formatted dashboard data
    return NextResponse.json(
      {
        success: true,
        balance: vaultBalance.underlyingUsdc,
        apy: apyInfo.formatted,
        data: {
          userAddress: vaultBalance.userAddress,
          contractId: vaultBalance.contractId,
          balance: vaultBalance.underlyingUsdc,
          formattedBalance: `${(Number(vaultBalance.underlyingUsdc) || 0).toFixed(2)} USDC`,
          underlyingUsdc: vaultBalance.underlyingUsdc,
          userShares: vaultBalance.userBalance,
          sharePrice: vaultBalance.sharePrice,
          rawUnderlyingUsdc: vaultBalance.rawUnderlyingUsdc,
          rawUserShares: vaultBalance.rawUserBalance,
          rawSharePrice: vaultBalance.rawSharePrice,
          rawTotalSupply: vaultBalance.rawTotalSupply,
          rawTotalManagedFunds: vaultBalance.rawTotalManagedFunds,
          currency: "USDC",
          savingsStatus: user.savingsStatus,
          cachedSavingsBalance: user.savingsBalance,
          apy: apyInfo.formatted,
          apyRate: apyInfo.rate,
          apyInfo,
          recentTransactions,
          fetchedAt: vaultBalance.fetchedAt,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[SAVINGS_DASHBOARD_ERROR]", error);

    if (error instanceof DefindexServiceError) {
      switch (error.kind) {
        case "configuration":
          return createProblemDetails(
            "about:blank",
            "Internal Server Error",
            500,
            "The DeFindex vault is not configured correctly",
          );
        case "upstream":
          return createProblemDetails(
            "about:blank",
            "Bad Gateway",
            502,
            "The DeFindex vault could not be reached or simulated at this time",
          );
        case "validation":
        default:
          return createProblemDetails(
            "about:blank",
            "Bad Request",
            400,
            error.message,
          );
      }
    }

    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to retrieve savings dashboard data",
    );
  }
}
