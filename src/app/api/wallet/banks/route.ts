import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bankAccounts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { addBankAccountSchema } from "@/lib/validations/bank";

const maskAccountNumber = (accountNumber: string) =>
  accountNumber.length > 4 ? `****${accountNumber.slice(-4)}` : "****";

export async function GET(req: NextRequest) {
  try {
    const payload = await getAuthPayload(req);
    if (!payload?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accounts = await db.query.bankAccounts.findMany({
      where: eq(bankAccounts.userId, payload.userId),
      columns: {
        id: true,
        country: true,
        currency: true,
        swiftBic: true,
        accountNumber: true,
        createdAt: true,
      },
      orderBy: [desc(bankAccounts.createdAt)],
    });

    return NextResponse.json(
      {
        success: true,
        bankAccounts: accounts.map((account) => ({
          id: account.id,
          country: account.country,
          currency: account.currency,
          swiftBic: account.swiftBic,
          accountNumber: maskAccountNumber(account.accountNumber),
          createdAt: account.createdAt,
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching bank accounts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await getAuthPayload(req);
    if (!payload?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validationResult = addBankAccountSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: validationResult.error.format() },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    // Mask account number for response
    const maskedAccountNumber =
      data.accountNumber.length > 4
        ? "****" + data.accountNumber.slice(-4)
        : "****";

    const [bankAccount] = await db
      .insert(bankAccounts)
      .values({
        userId: payload.userId,
        country: data.country,
        currency: data.currency,
        swiftBic: data.swiftBic,
        accountNumber: data.accountNumber,
      })
      .returning();

    return NextResponse.json(
      {
        message: "Bank account added successfully",
        bankAccount: {
          id: bankAccount.id,
          country: bankAccount.country,
          currency: bankAccount.currency,
          swiftBic: bankAccount.swiftBic,
          accountNumber: maskedAccountNumber,
          createdAt: bankAccount.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error adding bank account:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
