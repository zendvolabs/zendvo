import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankAccounts } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

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

    // Select only non-sensitive columns; encrypted account number material
    // (ciphertext, iv, auth tag, fingerprint) is never read or returned.
    const rows = await db
      .select({
        id: bankAccounts.id,
        bankName: bankAccounts.bankName,
        accountName: bankAccounts.accountName,
        accountNumberLast4: bankAccounts.accountNumberLast4,
        country: bankAccounts.country,
        currency: bankAccounts.currency,
        routingNumber: bankAccounts.routingNumber,
        sortCode: bankAccounts.sortCode,
        bankCode: bankAccounts.bankCode,
        swiftBic: bankAccounts.swiftBic,
        isDefault: bankAccounts.isDefault,
        createdAt: bankAccounts.createdAt,
        updatedAt: bankAccounts.updatedAt,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, payload.userId))
      .orderBy(desc(bankAccounts.isDefault), desc(bankAccounts.createdAt));

    const accounts = rows.map((row) => ({
      ...row,
      maskedAccountNumber: `****${row.accountNumberLast4}`,
    }));

    return NextResponse.json({ success: true, accounts }, { status: 200 });
  } catch (error) {
    console.error("Error listing bank accounts:", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
