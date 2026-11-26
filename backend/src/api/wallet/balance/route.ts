import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { wallets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

type WalletBalance = {
  currency: string;
  balance: number;
};

export async function GET(request: NextRequest) {
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

    const userWallets = await db.query.wallets.findMany({
      where: eq(wallets.userId, payload.userId),
      columns: {
        currency: true,
        balance: true,
      },
      orderBy: (wallets, { asc }) => [asc(wallets.currency)],
    });

    const balances: WalletBalance[] = userWallets.map((w) => ({
      currency: w.currency,
      balance: w.balance,
    }));

    return NextResponse.json(
      {
        success: true,
        balances,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in wallet/balance:", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
