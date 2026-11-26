import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { StrKey } from "@stellar/stellar-sdk";

import { db } from "@/lib/db";
import { savingsHistory, users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  DefindexServiceError,
  getVaultDashboardMetrics,
  SharePriceSnapshot,
} from "@/lib/services/defindex_service";

const TRANSACTION_LIMIT = 20;

function problemTitleForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 404:
      return "Not Found";
    case 500:
      return "Internal Server Error";
    case 502:
      return "Bad Gateway";
    case 503:
      return "Service Unavailable";
    default:
      return "Internal Server Error";
  }
}

export async function GET(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication is required to access the savings dashboard.",
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
        "User not found.",
      );
    }

    if (
      !user.stellarAddress ||
      !StrKey.isValidEd25519PublicKey(user.stellarAddress)
    ) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "No registered Stellar address was found for this account.",
      );
    }

    const vaultAddress =
      user.vaultContractId ||
      process.env.DEFINDEX_VAULT_ADDRESS ||
      process.env.SOROBAN_VAULT_CONTRACT_ID;

    if (!vaultAddress || !StrKey.isValidContract(vaultAddress)) {
      return createProblemDetails(
        "about:blank",
        "Service Unavailable",
        503,
        "A savings vault is not configured for this account.",
      );
    }

    const history = db.query?.savingsHistory?.findMany
      ? await db.query.savingsHistory.findMany({
          where: eq(savingsHistory.userId, user.id),
          orderBy: [desc(savingsHistory.createdAt)],
          limit: TRANSACTION_LIMIT,
        })
      : [];

    const snapshots: SharePriceSnapshot[] = [];
    for (const row of history) {
      if (
        row.vaultContractId === vaultAddress &&
        row.sharePrice !== null &&
        row.sharePrice > 0
      ) {
        snapshots.push({
          sharePrice: row.sharePrice,
          recordedAt: row.createdAt,
        });
      }
    }

    const transactions = history.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      transactionHash: row.transactionHash,
      sharePrice: row.sharePrice,
      sharesBalance: row.sharesBalance,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(row.createdAt).toISOString(),
    }));

    const metrics = await getVaultDashboardMetrics({
      vaultAddress,
      stellarAddress: user.stellarAddress,
      sharePriceHistory: snapshots,
    });

    const dashboard = {
      vaultBalance: metrics.vaultBalance,
      shareBalance: metrics.shareBalance,
      sharePrice: metrics.sharePrice,
      apy: metrics.apy,
      transactions,
    };

    return NextResponse.json({
      success: true,
      data: dashboard,
      ...dashboard,
    });
  } catch (error) {
    if (error instanceof DefindexServiceError) {
      return createProblemDetails(
        "about:blank",
        problemTitleForStatus(error.status),
        error.status,
        error.message,
      );
    }

    console.error("[SAVINGS_DASHBOARD_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to retrieve the savings dashboard.",
    );
  }
}
