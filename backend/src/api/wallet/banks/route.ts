import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bankAccounts } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  BankEncryptionConfigError,
  encryptAccountNumber,
  fingerprintAccountNumber,
  normalizeAccountNumber,
} from "@/lib/bank-encryption";

const optionalCode = (schema: z.ZodString) =>
  z
    .union([schema, z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined));

const linkBankAccountSchema = z.object({
  bankName: z.string().trim().min(1).max(100),
  accountName: z.string().trim().min(1).max(100),
  // Digits for most countries, alphanumeric for IBANs. Spaces/hyphens allowed
  // for readability and removed before storage.
  accountNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, "Invalid account number")
    .refine(
      (value) => {
        const length = normalizeAccountNumber(value).length;
        return length >= 4 && length <= 34;
      },
      { message: "Account number must be between 4 and 34 characters" },
    ),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Country must be an ISO 3166-1 alpha-2 code")
    .transform((value) => value.toUpperCase()),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Currency must be an ISO 4217 code")
    .transform((value) => value.toUpperCase()),
  swiftBic: optionalCode(
    z
      .string()
      .trim()
      .regex(
        /^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/,
        "Invalid SWIFT/BIC code",
      ),
  ).transform((value) => value?.toUpperCase()),
  sortCode: optionalCode(
    z
      .string()
      .trim()
      .regex(/^\d{2}-?\d{2}-?\d{2}$/, "Sort code must be 6 digits"),
  ).transform((value) => value?.replace(/-/g, "")),
  bankCode: optionalCode(
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{2,20}$/, "Invalid bank code"),
  ),
});

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Unauthorized");
    }
    const { userId } = payload;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return createProblemDetails("about:blank", "Bad Request", 400, "Invalid JSON body");
    }

    const parsed = linkBankAccountSchema.safeParse(body);
    if (!parsed.success) {
      // Report field paths and messages only; never echo submitted values.
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid input data",
        undefined,
        {
          errors: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
      );
    }

    const {
      bankName,
      accountName,
      accountNumber,
      country,
      currency,
      swiftBic,
      sortCode,
      bankCode,
    } = parsed.data;

    const normalized = normalizeAccountNumber(accountNumber);
    const fingerprint = fingerprintAccountNumber(normalized);

    const duplicateResponse = () =>
      createProblemDetails(
        "about:blank",
        "Conflict",
        409,
        "This bank account is already linked to your account",
      );

    const existing = await db.query.bankAccounts.findFirst({
      where: and(
        eq(bankAccounts.userId, userId),
        eq(bankAccounts.accountNumberFingerprint, fingerprint),
      ),
      columns: { id: true },
    });
    if (existing) {
      return duplicateResponse();
    }

    const encrypted = encryptAccountNumber(normalized);

    let created;
    try {
      [created] = await db
        .insert(bankAccounts)
        .values({
          userId,
          bankName,
          accountName,
          accountNumberCiphertext: encrypted.ciphertext,
          accountNumberIv: encrypted.iv,
          accountNumberAuthTag: encrypted.authTag,
          accountNumberKeyVersion: encrypted.keyVersion,
          accountNumberLast4: normalized.slice(-4),
          accountNumberFingerprint: fingerprint,
          country,
          currency,
          swiftBic: swiftBic ?? null,
          sortCode: sortCode ?? null,
          bankCode: bankCode ?? null,
        })
        .returning();
    } catch (error) {
      // Concurrent duplicate request lost the race against the unique constraint.
      if (isUniqueViolation(error)) {
        return duplicateResponse();
      }
      throw error;
    }

    // Explicit allow-list: encrypted material and the fingerprint never leave the server.
    return NextResponse.json(
      {
        success: true,
        message: "Bank account linked successfully",
        data: {
          id: created.id,
          bankName: created.bankName,
          accountName: created.accountName,
          accountNumberLast4: created.accountNumberLast4,
          country: created.country,
          currency: created.currency,
          swiftBic: created.swiftBic,
          sortCode: created.sortCode,
          bankCode: created.bankCode,
          isDefault: created.isDefault,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BankEncryptionConfigError) {
      console.error("[LINK_BANK_ACCOUNT_CONFIG_ERROR]", error.message);
    } else {
      console.error("[LINK_BANK_ACCOUNT_ERROR]", (error as Error)?.name);
    }
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to link bank account",
    );
  }
}

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
