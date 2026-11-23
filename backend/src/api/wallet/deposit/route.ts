import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { buildDepositTransaction } from "@/lib/services/defindex_service";

const schema = z.object({
  amount: z.union([z.string(), z.number()]).refine((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  }, "Amount must be a positive number"),
});

export async function POST(request: NextRequest) {
  const payload = await getAuthPayload(request);
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  // Convert decimal USDC (7 decimals on Stellar) to integer base units without
  // floating point rounding. Reject precision beyond the asset's decimals.
  const amount = String(parsed.data.amount).trim();
  if (!/^\d+(?:\.\d{1,7})?$/.test(amount)) {
    return NextResponse.json({ error: "Amount must have at most 7 decimal places" }, { status: 400 });
  }
  const [whole, fraction = ""] = amount.split(".");
  const stroops = BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
  if (stroops <= 0n || stroops > BigInt(Number.MAX_SAFE_INTEGER)) {
    return NextResponse.json({ error: "Amount is outside the supported range" }, { status: 400 });
  }

  const [user] = await db.select({ stellarAddress: users.stellarAddress })
    .from(users).where(eq(users.id, payload.userId));
  if (!user?.stellarAddress) {
    return NextResponse.json({ error: "No registered Stellar address" }, { status: 400 });
  }
  const vaultAddress = process.env.DEFINDEX_VAULT_ADDRESS || process.env.SOROBAN_VAULT_CONTRACT_ID;
  if (!vaultAddress) {
    return NextResponse.json({ error: "Deposit vault is not configured" }, { status: 503 });
  }

  try {
    const transaction = await buildDepositTransaction({
      vaultAddress,
      caller: user.stellarAddress,
      amount: stroops,
    });
    return NextResponse.json({
      success: true,
      xdr: transaction.xdr,
      amount: stroops.toString(),
      fee: transaction.fee,
      resourceFee: transaction.resourceFee,
      simulation: transaction.simulation,
    });
  } catch (error) {
    console.error("[WALLET_DEPOSIT_ERROR]", error);
    return NextResponse.json({ error: "Failed to build deposit transaction" }, { status: 502 });
  }
}
