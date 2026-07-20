import { NextRequest, NextResponse } from "next/server";
import { createProblemDetails, paginatedResponse } from "@/lib/api-utils";
import { db } from "@/lib/db";
import { users, gifts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  sanitizeInput,
  validateMessage,
  validateUnlockAt,
  convertToUTCDate,
  formatAsUTCISO,
  CreateGiftSchema,
} from "@/lib/validation";
import { generateOTP, storeGiftOTP } from "@/server/services/otpService";
import { sendGiftConfirmationOTP } from "@/server/services/emailService";
import { calculateFee } from "@/lib/fees";
import { generateUniqueSlug } from "@/lib/slug";
import { generateUniqueShortCode } from "@/lib/shortCode";

export async function GET() {
  return paginatedResponse([], 0, 1, 10);
}

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

    
    const validationResult = CreateGiftSchema.safeParse(body);

    if (!validationResult.success) {
      const firstError = validationResult.error.issues[0];
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        firstError.message,
      );
    }

    const {
      recipient,
      amount,
      currency,
      message,
      template,
      coverImageId,
      unlock_at,
    } = validationResult.data;

    
    const recipientUser = await db.query.users.findFirst({
      where: eq(users.id, recipient),
    });

    if (!recipientUser) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "Recipient not found",
      );
    }

    
    if (recipient === userId) {
      return createProblemDetails(
        "about:blank",
        "Unprocessable Entity",
        422,
        "Cannot send gift to yourself",
      );
    }

    
    const sanitizedMessage = message ? sanitizeInput(message) : null;
    const sanitizedTemplate = template ? sanitizeInput(template) : null;
    const sanitizedCoverImageId = coverImageId
      ? sanitizeInput(String(coverImageId))
      : null;

    
    if (!validateMessage(sanitizedMessage)) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Message cannot exceed 500 characters",
      );
    }

    
    if (unlock_at) {
      const unlockValidation = validateUnlockAt(unlock_at);
      if (!unlockValidation.valid) {
        return createProblemDetails(
          "about:blank",
          "Bad Request",
          400,
          unlockValidation.error || "Invalid delivery date",
        );
      }
    }

    
    const slug = await generateUniqueSlug();

    
    const shortCode = await generateUniqueShortCode();

    
    const [newGift] = await db
      .insert(gifts)
      .values({
        senderId: userId,
        recipientId: recipient,
        amount,
        currency,
        message: sanitizedMessage,
        template: sanitizedTemplate,
        coverImageId: sanitizedCoverImageId,
        unlockDatetime: unlock_at ? convertToUTCDate(unlock_at) : null,
        status: "pending_otp" as const,
        slug,
        shortCode,
        totalAmount: amount,
      })
      .returning();

    
    const otp = generateOTP();
    await storeGiftOTP(newGift.id, otp);

    
    const emailResult = await sendGiftConfirmationOTP(
      userEmail,
      otp,
      recipientUser.name || undefined,
    );

    if (!emailResult.success) {
      console.error(
        "Failed to send gift confirmation OTP:",
        emailResult.message,
      );
    }

    return NextResponse.json(
      {
        success: true,
        giftId: newGift.id,
        status: "pending_otp",
        slug: newGift.slug,
        shortCode: newGift.shortCode,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating gift:", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
