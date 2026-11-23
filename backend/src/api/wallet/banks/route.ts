import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankAccounts } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> },
) {
  try {
    const authPayload = await getAuthPayload(request);
    if (!authPayload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required",
      );
    }

    const { id } = await context.params;
    if (!id || !UUID_REGEX.test(id)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid bank account ID",
      );
    }

    const [deleted] = await db
      .delete(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, id),
          eq(bankAccounts.userId, authPayload.userId),
        ),
      )
      .returning({ id: bankAccounts.id });

    if (!deleted) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "Bank account not found",
      );
    }

    return NextResponse.json(
      { success: true, message: "Bank account unlinked successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("[UNLINK_BANK_ACCOUNT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to unlink bank account",
    );
  }
}
