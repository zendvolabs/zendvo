import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

function alreadyRegisteredResponse(stellarAddress: string) {
  return NextResponse.json(
    {
      success: true,
      message: "Stellar address already registered",
      stellarAddress,
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication required",
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const { stellarAddress } =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as { stellarAddress?: unknown })
        : {};

    if (typeof stellarAddress !== "string" || !stellarAddress.trim()) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "stellarAddress is required",
      );
    }

    const address = stellarAddress.trim();
    if (!address.startsWith("G") || !StrKey.isValidEd25519PublicKey(address)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid Stellar public address",
      );
    }

    const [user] = await db
      .select({ id: users.id, stellarAddress: users.stellarAddress })
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

    if (user.stellarAddress === address) {
      return alreadyRegisteredResponse(address);
    }

    const [existingOwner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.stellarAddress, address));

    if (existingOwner) {
      return createProblemDetails(
        "about:blank",
        "Conflict",
        409,
        "Stellar address is already registered to another account",
      );
    }

    try {
      const updated = await db
        .update(users)
        .set({ stellarAddress: address, updatedAt: new Date() })
        .where(eq(users.id, payload.userId))
        .returning({ id: users.id });

      if (updated.length === 0) {
        return createProblemDetails(
          "about:blank",
          "Not Found",
          404,
          "User not found",
        );
      }
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const [refreshed] = await db
        .select({ id: users.id, stellarAddress: users.stellarAddress })
        .from(users)
        .where(eq(users.id, payload.userId));

      if (refreshed?.stellarAddress === address) {
        return alreadyRegisteredResponse(address);
      }

      return createProblemDetails(
        "about:blank",
        "Conflict",
        409,
        "Stellar address is already registered to another account",
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Stellar address registered successfully",
        stellarAddress: address,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[WALLET_REGISTER_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to register Stellar address",
    );
  }
}
