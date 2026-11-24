import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  gifts,
  giftStatusEnum,
  transactions,
  transactionStatusEnum,
  transactionTypeEnum,
  users,
} from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

type GiftStatus = (typeof giftStatusEnum.enumValues)[number];
type TransactionStatus = (typeof transactionStatusEnum.enumValues)[number];
type TransactionType = (typeof transactionTypeEnum.enumValues)[number];

export type WalletTransactionFilterType =
  | "gift_received"
  | "gift_sent"
  | "withdrawal"
  | "top_up";

export type WalletTransactionType =
  | WalletTransactionFilterType
  | "transfer"
  | "blockchain_submission";

export type WalletTransactionStatus = "completed" | "pending" | "failed";

export interface WalletTransactionCounterparty {
  id: string | null;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export interface WalletTransactionItem {
  id: string;
  source: "transaction" | "gift";
  type: WalletTransactionType;
  direction: "credit" | "debit";
  status: WalletTransactionStatus;
  rawStatus: string;
  amount: number;
  fee: number;
  currency: string;
  reference: string | null;
  provider: string | null;
  blockchainTxHash: string | null;
  message: string | null;
  counterparty: WalletTransactionCounterparty | null;
  createdAt: Date;
  updatedAt: Date;
}

const VALID_TYPE_FILTERS = new Set<string>([
  "all",
  "gift_received",
  "gift_sent",
  "withdrawal",
  "top_up",
]);

const VALID_STATUS_FILTERS = new Set<string>([
  "completed",
  "pending",
  "failed",
]);

const GIFT_STATUS_MAP: Record<WalletTransactionStatus, GiftStatus[]> = {
  completed: ["completed", "sent"],
  pending: ["pending_otp", "otp_verified", "pending_review", "confirmed"],
  failed: ["failed"],
};

const TRANSACTION_STATUS_MAP: Record<
  WalletTransactionStatus,
  TransactionStatus[]
> = {
  completed: ["completed"],
  pending: ["pending", "submitted"],
  failed: ["failed"],
};

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function normalizeTransactionStatus(
  status: TransactionStatus,
): WalletTransactionStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

function normalizeGiftStatus(status: GiftStatus): WalletTransactionStatus {
  if (status === "completed" || status === "sent") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

function normalizeTransactionType(
  type: TransactionType,
): WalletTransactionType {
  if (type === "deposit") return "top_up";
  return type;
}

function getTransactionDirection(
  type: WalletTransactionType,
): "credit" | "debit" {
  if (type === "top_up" || type === "gift_received" || type === "transfer") {
    return "credit";
  }
  return "debit";
}

function toTimestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export async function GET(request: NextRequest) {
  try {
    const authPayload = await getAuthPayload(request);
    if (!authPayload) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Authentication is required to access this resource.",
      );
    }

    const { userId } = authPayload;
    const { searchParams } = new URL(request.url);

    const rawTypeParam = searchParams.get("type")?.trim() || null;
    const rawStatusParam = searchParams.get("status")?.trim() || null;

    if (rawTypeParam !== null && !VALID_TYPE_FILTERS.has(rawTypeParam)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid type. Must be one of: gift_received, gift_sent, withdrawal, top_up.",
      );
    }

    if (rawStatusParam !== null && !VALID_STATUS_FILTERS.has(rawStatusParam)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid status. Must be one of: completed, pending, failed.",
      );
    }

    const typeFilter: WalletTransactionFilterType | null =
      rawTypeParam === null || rawTypeParam === "all"
        ? null
        : (rawTypeParam as WalletTransactionFilterType);
    const statusFilter: WalletTransactionStatus | null =
      rawStatusParam as WalletTransactionStatus | null;

    const rawPage = parseInt(
      searchParams.get("page") ?? String(DEFAULT_PAGE),
      10,
    );
    const rawLimit = parseInt(
      searchParams.get("limit") ?? String(DEFAULT_LIMIT),
      10,
    );

    const page = Number.isNaN(rawPage) || rawPage < 1 ? DEFAULT_PAGE : rawPage;
    const limit =
      Number.isNaN(rawLimit) || rawLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(rawLimit, MAX_LIMIT);
    const offset = (page - 1) * limit;

    const queryTransactions =
      typeFilter === null ||
      typeFilter === "withdrawal" ||
      typeFilter === "top_up";
    const queryGifts =
      typeFilter === null ||
      typeFilter === "gift_received" ||
      typeFilter === "gift_sent";

    // When querying a single table we can paginate directly in SQL;
    // when merging both tables we fetch up to offset + limit from each table.
    const singleSource = !(queryTransactions && queryGifts);
    const fetchLimit = singleSource ? limit : offset + limit;
    const fetchOffset = singleSource ? offset : 0;

    const fetchTransactions = async (): Promise<{
      total: number;
      items: WalletTransactionItem[];
    }> => {
      const conditions: SQL[] = [eq(transactions.userId, userId)];

      if (typeFilter === "top_up") {
        conditions.push(eq(transactions.type, "deposit"));
      } else if (typeFilter === "withdrawal") {
        conditions.push(eq(transactions.type, "withdrawal"));
      }

      if (statusFilter !== null) {
        conditions.push(
          inArray(transactions.status, TRANSACTION_STATUS_MAP[statusFilter]),
        );
      }

      const whereClause = and(...conditions);

      const [countResult, rows] = await Promise.all([
        db
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(transactions)
          .where(whereClause),
        db
          .select({
            id: transactions.id,
            type: transactions.type,
            status: transactions.status,
            amount: transactions.amount,
            currency: transactions.currency,
            reference: transactions.reference,
            provider: transactions.provider,
            blockchainTxHash: transactions.blockchainTxHash,
            createdAt: transactions.createdAt,
            updatedAt: transactions.updatedAt,
          })
          .from(transactions)
          .where(whereClause)
          .orderBy(desc(transactions.createdAt), desc(transactions.id))
          .limit(fetchLimit)
          .offset(fetchOffset),
      ]);

      const mapped: WalletTransactionItem[] = rows.map((row) => {
        const normalizedType = normalizeTransactionType(row.type);
        return {
          id: row.id,
          source: "transaction",
          type: normalizedType,
          direction: getTransactionDirection(normalizedType),
          status: normalizeTransactionStatus(row.status),
          rawStatus: row.status,
          amount: row.amount,
          fee: 0,
          currency: row.currency,
          reference: row.reference,
          provider: row.provider,
          blockchainTxHash: row.blockchainTxHash,
          message: null,
          counterparty: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      return {
        total: countResult[0]?.count ?? 0,
        items: mapped,
      };
    };

    const fetchGifts = async (): Promise<{
      total: number;
      items: WalletTransactionItem[];
    }> => {
      const sender = alias(users, "sender");
      const recipient = alias(users, "recipient");

      const ownershipCondition =
        typeFilter === "gift_sent"
          ? eq(gifts.senderId, userId)
          : typeFilter === "gift_received"
            ? eq(gifts.recipientId, userId)
            : or(eq(gifts.senderId, userId), eq(gifts.recipientId, userId));

      const conditions: SQL[] = [];
      if (ownershipCondition) {
        conditions.push(ownershipCondition);
      }
      if (statusFilter !== null) {
        conditions.push(inArray(gifts.status, GIFT_STATUS_MAP[statusFilter]));
      }

      const whereClause =
        conditions.length === 1 ? conditions[0] : and(...conditions);

      const [countResult, rows] = await Promise.all([
        db
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(gifts)
          .where(whereClause),
        db
          .select({
            id: gifts.id,
            senderId: gifts.senderId,
            recipientId: gifts.recipientId,
            amount: gifts.amount,
            fee: gifts.fee,
            currency: gifts.currency,
            message: gifts.message,
            status: gifts.status,
            transactionId: gifts.transactionId,
            paymentReference: gifts.paymentReference,
            paymentProvider: gifts.paymentProvider,
            blockchainTxHash: gifts.blockchainTxHash,
            hideSender: gifts.hideSender,
            isAnonymous: gifts.isAnonymous,
            senderName: gifts.senderName,
            senderAvatar: gifts.senderAvatar,
            createdAt: gifts.createdAt,
            updatedAt: gifts.updatedAt,
            senderUserName: sender.name,
            senderUsername: sender.username,
            senderUserAvatar: sender.avatarUrl,
            recipientUserName: recipient.name,
            recipientUsername: recipient.username,
            recipientUserAvatar: recipient.avatarUrl,
          })
          .from(gifts)
          .leftJoin(sender, eq(gifts.senderId, sender.id))
          .leftJoin(recipient, eq(gifts.recipientId, recipient.id))
          .where(whereClause)
          .orderBy(desc(gifts.createdAt), desc(gifts.id))
          .limit(fetchLimit)
          .offset(fetchOffset),
      ]);

      const mapped: WalletTransactionItem[] = rows.map((row) => {
        const isSent =
          typeFilter === "gift_sent" ||
          (typeFilter !== "gift_received" && row.senderId === userId);
        const itemType: WalletTransactionType = isSent
          ? "gift_sent"
          : "gift_received";

        let counterparty: WalletTransactionCounterparty | null;
        if (isSent) {
          counterparty = {
            id: row.recipientId,
            name: row.recipientUserName ?? null,
            username: row.recipientUsername ?? null,
            avatarUrl: row.recipientUserAvatar ?? null,
          };
        } else if (row.isAnonymous || row.hideSender) {
          counterparty = null;
        } else {
          counterparty = {
            id: row.senderId,
            name: row.senderUserName ?? row.senderName ?? null,
            username: row.senderUsername ?? null,
            avatarUrl: row.senderUserAvatar ?? row.senderAvatar ?? null,
          };
        }

        return {
          id: row.id,
          source: "gift",
          type: itemType,
          direction: isSent ? "debit" : "credit",
          status: normalizeGiftStatus(row.status),
          rawStatus: row.status,
          amount: row.amount,
          fee: row.fee,
          currency: row.currency,
          reference: row.paymentReference ?? row.transactionId ?? null,
          provider: row.paymentProvider ?? null,
          blockchainTxHash: row.blockchainTxHash ?? null,
          message: row.message ?? null,
          counterparty,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      return {
        total: countResult[0]?.count ?? 0,
        items: mapped,
      };
    };

    const [txResult, giftResult] = await Promise.all([
      queryTransactions
        ? fetchTransactions()
        : Promise.resolve({ total: 0, items: [] as WalletTransactionItem[] }),
      queryGifts
        ? fetchGifts()
        : Promise.resolve({ total: 0, items: [] as WalletTransactionItem[] }),
    ]);

    const total = txResult.total + giftResult.total;
    const totalPages = Math.ceil(total / limit);

    let items: WalletTransactionItem[];
    if (singleSource) {
      items = queryTransactions ? txResult.items : giftResult.items;
    } else {
      items = [...txResult.items, ...giftResult.items]
        .sort((a, b) => {
          const timeDiff = toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
          if (timeDiff !== 0) return timeDiff;
          return b.id.localeCompare(a.id);
        })
        .slice(offset, offset + limit);
    }

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error("[WALLET_TRANSACTIONS_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to retrieve wallet transactions.",
    );
  }
}
