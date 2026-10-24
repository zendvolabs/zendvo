import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { gifts, notifications, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import { sendAppreciationEmailToSender } from "@/server/services/emailService";
import { z } from "zod";

// Human-readable labels, so internal reaction codes never reach a user.
const REACTION_LABELS = {
  heart: "❤️ Heart",
  thumbs_up: "👍 Thumbs up",
  dua: "🤲 Dua",
  star: "⭐ Star",
  party: "🎉 Party",
} as const;

const appreciationSchema = z
  .object({
    message: z.string().trim().max(500).optional(),
    template: z.string().trim().max(200).optional(),
    reaction: z.enum(["heart", "thumbs_up", "dua", "star", "party"]).optional(),
    id: z.string().optional(),
  })
  .refine((data) => Boolean(data.message || data.template || data.reaction), {
    message: "Provide at least one of: message, template, reaction",
  });

export async function POST(
  request: NextRequest,
  context?: { params?: Promise<{ id?: string }> },
) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Unauthorized");
    }

    const { userId } = payload;

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // empty body tolerated; validation below will reject if nothing usable
    }

    const parsed = appreciationSchema.safeParse(body);
    if (!parsed.success) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid input data",
      );
    }

    const { message: customMessage, template: templateMessage, reaction, id: bodyId } =
      parsed.data;

    // Extract gift ID: route params -> body -> URL fallback
    let giftId: string | undefined;
    if (context?.params) {
      const params = await context.params;
      giftId = params.id;
    }
    if (!giftId) giftId = bodyId;
    if (!giftId) {
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter(Boolean);
      const appreciateIdx = segments.indexOf("appreciate");
      if (appreciateIdx > 0) {
        const possibleId = segments[appreciateIdx - 1];
        if (possibleId !== "gifts" && possibleId !== "api") {
          giftId = possibleId;
        }
      }
    }

    if (!giftId) {
      return createProblemDetails("about:blank", "Bad Request", 400, "Missing gift ID parameter");
    }

    const gift = await db.query.gifts.findFirst({
      where: eq(gifts.id, giftId),
    });

    if (!gift) {
      return createProblemDetails("about:blank", "Not Found", 404, "Gift not found");
    }

    if (gift.recipientId !== userId) {
      return createProblemDetails(
        "about:blank",
        "Forbidden",
        403,
        "You are not authorized to send appreciation for this gift",
      );
    }

    if (gift.status !== "completed") {
      return createProblemDetails(
        "about:blank",
        "Gift Not Completed",
        400,
        "Gift must be completed before appreciation can be sent.",
        undefined,
        { status: gift.status },
      );
    }

    const recipientUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    const recipientName = recipientUser?.name || recipientUser?.username || "Recipient";

    let targetSenderEmail = gift.senderEmail;
    let targetSenderName = gift.senderName;

    if (gift.senderId) {
      const senderUser = await db.query.users.findFirst({
        where: eq(users.id, gift.senderId),
      });
      if (senderUser) {
        targetSenderEmail = targetSenderEmail || senderUser.email;
        targetSenderName = targetSenderName || senderUser.name || senderUser.username;
      }
    }

    const reactionLabel = reaction ? REACTION_LABELS[reaction] : null;
    const noteText = customMessage || templateMessage || null;
    const thankYouText =
      noteText ?? (reactionLabel ? `Reacted with ${reactionLabel}` : "");
    const notificationMessage = noteText
      ? `${recipientName} sent you a thank-you note: "${noteText}"${reactionLabel ? ` ${reactionLabel}` : ""}`
      : `${recipientName} reacted to your gift with ${reactionLabel}`;
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(gifts)
        .set({
          appreciationMessage: customMessage ?? null,
          appreciationReaction: reaction ?? null,
          appreciatedAt: now,
          updatedAt: now,
        })
        .where(eq(gifts.id, gift.id));

      if (gift.senderId) {
        await tx.insert(notifications).values({
          userId: gift.senderId,
          type: "GIFT_APPRECIATION",
          title: "Gift Appreciation Received!",
          message: notificationMessage,
          read: false,
        });
      }
    });

    if (targetSenderEmail) {
      await sendAppreciationEmailToSender({
        senderEmail: targetSenderEmail,
        senderName: targetSenderName,
        recipientName,
        message: customMessage ?? null,
        template: templateMessage ?? null,
        reaction: reactionLabel,
        amount: gift.amount,
        currency: gift.currency,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Appreciation delivered to sender",
      data: {
        giftId: gift.id,
        appreciation: thankYouText,
        reaction: reaction ?? null,
        appreciatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error("[GIFT_APPRECIATE_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to deliver appreciation message",
    );
  }
}
