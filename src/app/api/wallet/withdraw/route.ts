import { NextRequest, NextResponse } from "next/server";
import { processWithdrawal } from "@/server/services/withdrawalService";
import { getAuthPayload } from "@/lib/auth-session";

export async function POST(req: NextRequest) {
  try {
    const payload = await getAuthPayload(req);
    const userId = payload?.userId;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { amount, currency, bankAccountId } = body;

    if (!amount || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "Valid amount is required" },
        { status: 400 }
      );
    }

    if (!currency || typeof currency !== "string") {
      return NextResponse.json(
        { error: "Currency is required" },
        { status: 400 }
      );
    }

    if (!bankAccountId || typeof bankAccountId !== "string") {
      return NextResponse.json(
        { error: "Bank account ID is required" },
        { status: 400 }
      );
    }

    const result = await processWithdrawal({
      userId,
      amount,
      currency,
      bankAccountId,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error("Withdrawal API error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
