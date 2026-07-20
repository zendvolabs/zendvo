import { NextRequest, NextResponse } from "next/server";
import { createProblemDetails } from "@/lib/api-utils";
import { db } from "@/lib/db";
import { users, gifts } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  sanitizeInput,
  validateMessage,
  validateUnlockAt,
  convertToUTCDate,
  CreateGiftSchema,
} from "@/lib/validation";
import { generateUniqueSlug } from "@/lib/slug";
import { generateUniqueShortCode } from "@/lib/shortCode";
import { z } from "zod";

const BulkGiftRequestSchema = z.object({
  gifts: z.array(CreateGiftSchema).min(1, "Minimum 1 gift required").max(50, "Maximum 50 gifts allowed in one bulk request"),
});


export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get("x-user-id");
    const userEmail = request.headers.get("x-user-email");

    if (!userId || !userEmail) {
      return createProblemDetails(
        "about:blank",
        "Unauthorized",
        401,
        "Unauthorized",
      );
    }

    const body = await request.json();
    const validationResult = BulkGiftRequestSchema.safeParse(body);

    if (!validationResult.success) {
      const firstError = validationResult.error.issues[0];
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        firstError.message,
      );
    }

    const { gifts: requestedGifts } = validationResult.data;

    
    const recipientIds = [...new Set(requestedGifts.map((g) => g.recipient))];
    
    
    if (recipientIds.includes(userId)) {
        return createProblemDetails(
          "about:blank",
          "Unprocessable Entity",
          422,
          "Cannot send gifts to yourself",
        );
    }

    const foundRecipients = await db.query.users.findMany({
      where: inArray(users.id, recipientIds),
      columns: { id: true, name: true, email: true },
    });

    if (foundRecipients.length !== recipientIds.length) {
      const foundIds = foundRecipients.map((r) => r.id);
      const missingIds = recipientIds.filter((id) => !foundIds.includes(id));
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        `Some recipients not found: ${missingIds.join(", ")}`,
      );
    }

    const recipientMap = new Map(foundRecipients.map((r) => [r.id, r]));

    
    const createdGifts = await db.transaction(async (tx) => {
      const giftRecords = [];

      for (const giftInput of requestedGifts) {
        const sanitizedMessage = giftInput.message ? sanitizeInput(giftInput.message) : null;
        const sanitizedTemplate = giftInput.template ? sanitizeInput(giftInput.template) : null;
        const sanitizedCoverImageId = giftInput.coverImageId ? sanitizeInput(String(giftInput.coverImageId)) : null;
        
        const utcUnlockDatetime = giftInput.unlock_at ? convertToUTCDate(giftInput.unlock_at) : null;
        
        const slug = await generateUniqueSlug();
        const shortCode = await generateUniqueShortCode();

        giftRecords.push({
          senderId: userId,
          recipientId: giftInput.recipient,
          amount: giftInput.amount,
          currency: giftInput.currency,
          message: sanitizedMessage,
          template: sanitizedTemplate,
          coverImageId: sanitizedCoverImageId,
          unlockDatetime: utcUnlockDatetime,
          status: "pending_otp" as const,
          slug,
          shortCode,
          totalAmount: giftInput.amount,
        });
      }

      return await tx.insert(gifts).values(giftRecords).returning();
    });

    
    
    
    console.log(`[BULK_GIFT] Created ${createdGifts.length} gifts for sender ${userId}`);

    return NextResponse.json(
      {
        success: true,
        count: createdGifts.length,
        gifts: createdGifts.map((g) => ({
          id: g.id,
          slug: g.slug,
          shortCode: g.shortCode,
          recipientId: g.recipientId,
        })),
        message: "Bulk gifts created successfully. Please proceed to payment for each.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[BULK_GIFT_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error while creating bulk gifts",
    );
  }
}
