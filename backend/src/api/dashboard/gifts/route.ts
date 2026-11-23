import { NextRequest, NextResponse } from "next/server";
import { and, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { gifts, giftStatusEnum, users } from "@/lib/db/schema";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";

type GiftStatus = (typeof giftStatusEnum.enumValues)[number];

const VALID_STATUSES = new Set<string>(giftStatusEnum.enumValues);
const VALID_TYPES = new Set(["all", "sent", "received"]);

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

    const typeParam = searchParams.get("type") ?? "all";
    const statusParam = searchParams.get("status");
    const rawPage = parseInt(searchParams.get("page") ?? String(DEFAULT_PAGE), 10);
    const rawLimit = parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);

    if (!VALID_TYPES.has(typeParam)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        `Invalid type. Must be one of: all, sent, received.`,
      );
    }

    if (statusParam !== null && !VALID_STATUSES.has(statusParam)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        `Invalid status. Must be one of: ${giftStatusEnum.enumValues.join(", ")}.`,
      );
    }

    const page = isNaN(rawPage) || rawPage < 1 ? DEFAULT_PAGE : rawPage;
    const limit =
      isNaN(rawLimit) || rawLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(rawLimit, MAX_LIMIT);
    const offset = (page - 1) * limit;

    // Alias users table twice for sender and recipient joins
    const sender = alias(users, "sender");
    const recipient = alias(users, "recipient");

    // Build ownership filter based on type
    const ownershipFilter =
      typeParam === "sent"
        ? eq(gifts.senderId, userId)
        : typeParam === "received"
          ? eq(gifts.recipientId, userId)
          : or(eq(gifts.senderId, userId), eq(gifts.recipientId, userId));

    // Build status filter
    const statusFilter =
      statusParam !== null
        ? eq(gifts.status, statusParam as GiftStatus)
        : undefined;

    const whereClause =
      statusFilter !== undefined
        ? and(ownershipFilter, statusFilter)
        : ownershipFilter;

    // Run count and data queries in parallel
    const [countResult, rows] = await Promise.all([
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(gifts)
        .where(whereClause),

      db
        .select({
          id: gifts.id,
          amount: gifts.amount,
          fee: gifts.fee,
          totalAmount: gifts.totalAmount,
          currency: gifts.currency,
          message: gifts.message,
          template: gifts.template,
          status: gifts.status,
          hideAmount: gifts.hideAmount,
          hideSender: gifts.hideSender,
          isAnonymous: gifts.isAnonymous,
          unlockDatetime: gifts.unlockDatetime,
          senderName: gifts.senderName,
          senderEmail: gifts.senderEmail,
          senderAvatar: gifts.senderAvatar,
          shareLink: gifts.shareLink,
          slug: gifts.slug,
          shortCode: gifts.shortCode,
          completedAt: gifts.completedAt,
          createdAt: gifts.createdAt,
          updatedAt: gifts.updatedAt,
          // Sender user metadata
          senderId: gifts.senderId,
          senderUserId: sender.id,
          senderUserName: sender.name,
          senderUsername: sender.username,
          senderUserEmail: sender.email,
          senderUserAvatar: sender.avatarUrl,
          // Recipient user metadata
          recipientId: gifts.recipientId,
          recipientUserId: recipient.id,
          recipientUserName: recipient.name,
          recipientUsername: recipient.username,
          recipientUserEmail: recipient.email,
          recipientUserAvatar: recipient.avatarUrl,
        })
        .from(gifts)
        .leftJoin(sender, eq(gifts.senderId, sender.id))
        .innerJoin(recipient, eq(gifts.recipientId, recipient.id))
        .where(whereClause)
        .orderBy(sql`${gifts.createdAt} desc`)
        .limit(limit)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;
    const totalPages = Math.ceil(total / limit);

    const items = rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      fee: row.fee,
      totalAmount: row.totalAmount,
      currency: row.currency,
      message: row.message,
      template: row.template,
      status: row.status,
      hideAmount: row.hideAmount,
      hideSender: row.hideSender,
      isAnonymous: row.isAnonymous,
      unlockDatetime: row.unlockDatetime,
      shareLink: row.shareLink,
      slug: row.slug,
      shortCode: row.shortCode,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sender: row.senderId
        ? {
            id: row.senderId,
            name: row.senderUserName ?? row.senderName,
            username: row.senderUsername,
            email: row.isAnonymous || row.hideSender ? null : row.senderUserEmail ?? row.senderEmail,
            avatarUrl: row.senderUserAvatar ?? row.senderAvatar,
          }
        : {
            id: null,
            name: row.isAnonymous || row.hideSender ? null : row.senderName,
            username: null,
            email: row.isAnonymous || row.hideSender ? null : row.senderEmail,
            avatarUrl: row.senderAvatar,
          },
      recipient: {
        id: row.recipientId,
        name: row.recipientUserName,
        username: row.recipientUsername,
        email: row.recipientUserEmail,
        avatarUrl: row.recipientUserAvatar,
      },
    }));

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error("[DASHBOARD_GIFTS_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to retrieve gifts.",
    );
  }
}
