import { NextRequest } from "next/server";
import { and, asc, count, desc, eq, isNotNull, like, or } from "drizzle-orm";
import { createProblemDetails, paginatedResponse } from "@/lib/api-utils";
import { db } from "@/lib/db";
import { gifts } from "@/lib/db/schema";

const INTEGER_PARAM_REGEX = /^\d+$/;
const ALLOWED_SORT = ["asc", "desc"] as const;

type SortOrder = (typeof ALLOWED_SORT)[number];

const isValidPositiveInteger = (value: string): boolean =>
  INTEGER_PARAM_REGEX.test(value) && Number.parseInt(value, 10) >= 1;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const userId = searchParams.get("userId");
  const pageParam = searchParams.get("page") ?? "1";
  const limitParam = searchParams.get("limit") ?? "10";
  const sortParam = (searchParams.get("sort") ?? "desc").toLowerCase();

  if (
    !isValidPositiveInteger(pageParam) ||
    !isValidPositiveInteger(limitParam)
  ) {
    return createProblemDetails(
      "about:blank",
      "Bad Request",
      400,
      "page must be >= 1 and limit must be between 1 and 100",
    );
  }

  if (!ALLOWED_SORT.includes(sortParam as SortOrder)) {
    return createProblemDetails(
      "about:blank",
      "Bad Request",
      400,
      "sort must be either asc or desc",
    );
  }

  const page = Number.parseInt(pageParam, 10);
  const limit = Number.parseInt(limitParam, 10);

  if (limit > 100) {
    return createProblemDetails(
      "about:blank",
      "Bad Request",
      400,
      "page must be >= 1 and limit must be between 1 and 100",
    );
  }

  const isAsc = (sortParam as SortOrder) === "asc";
  const whereClause = and(
    isNotNull(gifts.transactionId),
    or(like(gifts.transactionId, "fund_%"), like(gifts.transactionId, "payout_%")),
    userId ? or(eq(gifts.senderId, userId), eq(gifts.recipientId, userId)) : undefined,
  );

  try {
    const [rows, [{ value: total }]] = await Promise.all([
      db.query.gifts.findMany({
        where: whereClause,
        limit,
        offset: (page - 1) * limit,
        orderBy: [isAsc ? asc(gifts.createdAt) : desc(gifts.createdAt)],
        columns: {
          id: true,
          senderId: true,
          recipientId: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          transactionId: true,
        },
      }),
      db.select({ value: count() }).from(gifts).where(whereClause),
    ]);

    const transactions = rows.map((row) => {
      const txId = row.transactionId ?? "";
      return {
        id: row.id,
        transactionId: row.transactionId,
        type: txId.startsWith("payout_") ? "withdrawal" : "deposit",
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        date:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : row.createdAt,
      };
    });

    return paginatedResponse(transactions, total, page, limit);
  } catch (error) {
    console.error("Wallet transactions fetch error:", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
