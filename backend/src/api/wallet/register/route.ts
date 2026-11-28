import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

const PG_UNIQUE_VIOLATION = "23505";
const WALLET_ADDRESS_CONSTRAINT = "users_stellar_address_unique";

function isWalletAddressUniqueViolation(error: unknown): boolean {
  const visited = new Set<object>();
  let current: unknown = error;

  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      detail?: unknown;
      cause?: unknown;
    };

    if (candidate.code === PG_UNIQUE_VIOLATION) {
      const constraint =
        typeof candidate.constraint === "string" ? candidate.constraint : "";
      const detail =
        typeof candidate.detail === "string" ? candidate.detail : "";

      if (!constraint && !detail) {
        return true;
      }

      return (
        constraint === WALLET_ADDRESS_CONSTRAINT ||
        detail.includes("stellar_address")
      );
    }

    current = candidate.cause;
  }

  return false;
}

function walletAlreadyRegisteredResponse() {
  return createProblemDetails(
    "about:blank",
    "Conflict",
    409,
    "Wallet already registered for this account",
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

    if (user.stellarAddress) {
      return walletAlreadyRegisteredResponse();
    }

    const [existingOwner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.stellarAddress, address));

    if (existingOwner) {
      if (existingOwner.id === payload.userId) {
        return alreadyRegisteredResponse(address);
      }

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
        .where(and(eq(users.id, payload.userId), isNull(users.stellarAddress)))
        .returning({ id: users.id });

      if (updated.length === 0) {
        const [refreshed] = await db
          .select({ id: users.id, stellarAddress: users.stellarAddress })
          .from(users)
          .where(eq(users.id, payload.userId));

        if (!refreshed) {
          return createProblemDetails(
            "about:blank",
            "Not Found",
            404,
            "User not found",
          );
        }

        if (refreshed.stellarAddress === address) {
          return alreadyRegisteredResponse(address);
        }

        return walletAlreadyRegisteredResponse();
      }
    } catch (error: unknown) {
      if (!isWalletAddressUniqueViolation(error)) {
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
