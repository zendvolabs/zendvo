import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { gifts, wallets } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

export async function GET(request: NextRequest) {
  try {
    const authPayload = await getAuthPayload(request);
    if (!authPayload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication is required to access this resource.",
      );
    }

    const { userId } = authPayload;
    const now = new Date();

    const [giftsReceivedResult, giftsSentResult, unopenedGiftsResult, walletRows] =
      await Promise.all([
        db
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(gifts)
          .where(
            and(
              eq(gifts.recipientId, userId),
              eq(gifts.status, "completed"),
            ),
          ),
        db
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(gifts)
          .where(
            and(eq(gifts.senderId, userId), eq(gifts.status, "completed")),
          ),
        db
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(gifts)
          .where(
            and(
              eq(gifts.recipientId, userId),
              ne(gifts.status, "completed"),
              ne(gifts.status, "failed"),
              gt(gifts.unlockDatetime, now),
            ),
          ),
        db
          .select({ currency: wallets.currency, balance: wallets.balance })
          .from(wallets)
          .where(eq(wallets.userId, userId)),
      ]);

    const balances = walletRows.reduce<Record<string, number>>(
      (acc, wallet) => {
        acc[wallet.currency] = wallet.balance;
        return acc;
      },
      {},
    );

    return NextResponse.json(
      {
        giftsReceived: giftsReceivedResult[0]?.count ?? 0,
        giftsSent: giftsSentResult[0]?.count ?? 0,
        unopenedGifts: unopenedGiftsResult[0]?.count ?? 0,
        balances,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[DASHBOARD_STATS_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to retrieve dashboard stats.",
    );
  }
}
