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
  context?: { params?: Promise<{ id?: string }> },
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

    const params = context?.params ? await context.params : undefined;
    const id = params?.id;

    if (!id || !UUID_REGEX.test(id)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "A valid bank account id is required",
      );
    }

    // Ownership is enforced in the WHERE clause so other users' accounts
    // are indistinguishable from nonexistent ones.
    const deleted = await db
      .delete(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, id),
          eq(bankAccounts.userId, authPayload.userId),
        ),
      )
      .returning({ id: bankAccounts.id });

    if (!deleted || deleted.length === 0) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "Bank account not found",
      );
    }

    return NextResponse.json(
      { success: true, message: "Bank account removed successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("[BANK_ACCOUNT_DELETE_ERROR]", error);

    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
