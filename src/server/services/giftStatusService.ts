import { db } from "@/lib/db";
import { gifts } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export const GIFT_STATUS_TRANSITIONS = {
  pending_otp: ["otp_verified", "failed"],
  otp_verified: ["pending_review", "confirmed", "failed"],
  pending_review: ["confirmed", "failed"],
  confirmed: ["completed", "sent", "failed"],
  completed: ["sent"],
  sent: [],
  failed: [],
} as const;

export type GiftStatus = keyof typeof GIFT_STATUS_TRANSITIONS;

export interface StatusTransitionResult {
  success: boolean;
  message: string;
  currentStatus?: string;
  allowedTransitions?: readonly string[];
}

export async function validateGiftStatusTransition(
  giftId: string,
  targetStatus: GiftStatus,
  currentUserId?: string,
): Promise<StatusTransitionResult> {
  const gift = await db.query.gifts.findFirst({
    where: eq(gifts.id, giftId),
  });

  if (!gift) {
    return {
      success: false,
      message: "Gift not found",
    };
  }

  const currentStatus = gift.status as GiftStatus;

  
  const allowedTransitions: readonly GiftStatus[] =
    GIFT_STATUS_TRANSITIONS[currentStatus] || [];

  if (!allowedTransitions.includes(targetStatus)) {
    return {
      success: false,
      message: `Invalid status transition from ${currentStatus} to ${targetStatus}. Allowed transitions: ${allowedTransitions.join(", ")}`,
      currentStatus,
      allowedTransitions,
    };
  }

  
  const validationResult = await validateBusinessRules(
    gift,
    targetStatus,
    currentUserId,
  );
  if (!validationResult.success) {
    return validationResult;
  }

  return {
    success: true,
    message: `Status transition from ${currentStatus} to ${targetStatus} is allowed`,
    currentStatus,
    allowedTransitions,
  };
}

async function validateBusinessRules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gift: any,
  targetStatus: GiftStatus,
  currentUserId?: string,
): Promise<StatusTransitionResult> {
  const now = new Date();

  switch (targetStatus) {
    case "otp_verified":
      
      if (
        gift.otpHash &&
        gift.otpExpiresAt &&
        now > new Date(gift.otpExpiresAt)
      ) {
        return {
          success: false,
          message: "OTP has expired. Please request a new verification code.",
        };
      }
      break;

    case "confirmed":
      
      if (!gift.unlockDatetime) {
        return {
          success: false,
          message: "Cannot lock gift: no unlock datetime specified",
        };
      }

      if (new Date(gift.unlockDatetime) <= now) {
        return {
          success: false,
          message: "Cannot lock gift: unlock datetime must be in the future",
        };
      }
      break;

    case "completed":
      
      if (gift.unlockDatetime && new Date(gift.unlockDatetime) > now) {
        return {
          success: false,
          message:
            "Gift cannot be unlocked yet. Please wait until the unlock datetime.",
        };
      }
      break;

    case "sent":
      
      if (gift.senderId) {
        
        
        if (gift.status !== "completed" && gift.status !== "confirmed") {
          return {
            success: false,
            message: `Gift must be completed or confirmed to be sent. Current status: ${gift.status}`,
          };
        }
      }
      break;

    default:
      break;
  }

  return { success: true, message: "Business rules validation passed" };
}

export async function transitionGiftStatus(
  giftId: string,
  targetStatus: GiftStatus,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>,
): Promise<StatusTransitionResult> {
  const validation = await validateGiftStatusTransition(giftId, targetStatus);

  if (!validation.success) {
    return validation;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { status: targetStatus };

    
    if (
      (targetStatus === "completed" || targetStatus === "sent") &&
      metadata?.transactionId
    ) {
      updateData.transactionId = metadata.transactionId;
    }

    await db.update(gifts).set(updateData).where(eq(gifts.id, giftId));

    return {
      success: true,
      message: `Gift status successfully updated to ${targetStatus}`,
    };
  } catch (error) {
    console.error(
      `Error transitioning gift ${giftId} to ${targetStatus}:`,
      error,
    );
    return {
      success: false,
      message: "Database error while updating gift status",
    };
  }
}

export async function markGiftPaymentSuccessfulByReference(
  reference: string,
  provider: "paystack" | "stripe",
): Promise<StatusTransitionResult> {
  try {
    const gift = await db.query.gifts.findFirst({
      where: and(
        eq(gifts.paymentReference, reference),
        eq(gifts.paymentProvider, provider),
      ),
    });

    if (!gift) {
      return {
        success: false,
        message: "Gift not found for payment reference",
      };
    }

    const alreadyProcessedStatuses = [
      "pending_review",
      "confirmed",
      "completed",
      "sent",
    ];

    if (alreadyProcessedStatuses.includes(gift.status as string)) {
      return {
        success: true,
        message: `Gift already processed with status ${gift.status}`,
        currentStatus: gift.status,
      };
    }

    await db
      .update(gifts)
      .set({
        status: "pending_review",
        paymentVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(gifts.id, gift.id));

    return {
      success: true,
      message: "Gift payment marked successful",
      currentStatus: "pending_review",
    };
  } catch (error) {
    console.error("Error marking gift payment successful by reference:", error);
    return {
      success: false,
      message: "Database error while marking payment successful",
    };
  }
}

export function getGiftStatusFlow(): GiftStatus[] {
  return [
    "pending_otp",
    "otp_verified",
    "pending_review",
    "confirmed",
    "completed",
    "sent",
    "failed",
  ];
}

export function isTerminalStatus(status: GiftStatus): boolean {
  return status === "sent" || status === "failed";
}

export function canTransitionFrom(
  currentStatus: GiftStatus,
  targetStatus: GiftStatus,
): boolean {
  const transitions: readonly GiftStatus[] =
    GIFT_STATUS_TRANSITIONS[currentStatus] || [];
  return transitions.includes(targetStatus);
}
