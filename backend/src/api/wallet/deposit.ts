import { NextRequest, NextResponse } from "next/server";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  buildDeFindexDepositXdr,
  DeFindexServiceError,
} from "@/lib/services/defindex_service";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const payload = await getAuthPayload(request);
  if (!payload) {
    return createProblemDetails(
      "about:blank",
      "Unauthorized",
      401,
      "Authentication required",
    );
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { amount } =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as { amount?: unknown })
      : { amount: undefined };

  if (typeof amount !== "string" || !amount.trim()) {
    return createProblemDetails(
      "about:blank",
      "Bad Request",
      400,
      'amount is required and must be a non-empty string (e.g. "50.00")',
    );
  }

  // 3. Resolve the user's registered Stellar address
  const [user] = await db
    .select({ stellarAddress: users.stellarAddress })
    .from(users)
    .where(eq(users.id, payload.userId));

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
      "Unprocessable Entity",
      422,
      "No Stellar address registered for this account. Register one via /api/wallet/register first.",
    );
  }

  // 4. Build the unsigned deposit XDR via DeFindex service
  try {
    const unsignedXdr = await buildDeFindexDepositXdr(
      user.stellarAddress,
      amount.trim(),
    );

    return NextResponse.json({ unsignedXdr });
  } catch (err) {
    if (err instanceof DeFindexServiceError) {
      // Surface validation / config problems as 422
      const isConfig = err.message.includes("DEFINDEX_VAULT_CONTRACT_ID");
      const status = isConfig ? 503 : 422;
      return createProblemDetails(
        "about:blank",
        isConfig ? "Service Unavailable" : "Unprocessable Entity",
        status,
        err.message,
      );
    }

    console.error("[deposit] Unexpected error:", err);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "An unexpected error occurred while building the deposit transaction.",
    );
  }
}
