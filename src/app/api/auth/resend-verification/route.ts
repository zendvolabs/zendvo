import { NextResponse } from "next/server";
import { generateOTP, storeOTP } from "@/server/services/otpService";
import { sendVerificationEmail } from "@/server/services/emailService";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const resendAttempts = new Map<string, { count: number; resetAt: number }>();

const MAX_RESENDS_PER_HOUR = 3;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, email, name } = body;

    if (!userId || !email) {
      return NextResponse.json(
        { error: "userId and email are required" },
        { status: 400 },
      );
    }

    const now = Date.now();
    const userAttempts = resendAttempts.get(userId);

    if (userAttempts) {
      if (now > userAttempts.resetAt) {
        resendAttempts.delete(userId);
      } else if (userAttempts.count >= MAX_RESENDS_PER_HOUR) {
        const remainingTime = Math.ceil(
          (userAttempts.resetAt - now) / 1000 / 60,
        );
        return NextResponse.json(
          {
            error: "Rate limit exceeded",
            message: `Too many resend attempts. Please try again in ${remainingTime} minutes.`,
            retryAfter: remainingTime,
          },
          { status: 429 },
        );
      }
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.status === "active") {
      return NextResponse.json(
        { message: "Email already verified" },
        { status: 200 },
      );
    }

    const otp = generateOTP();
    await storeOTP(userId, otp);

    const emailResult = await sendVerificationEmail(email, otp, name);

    if (!emailResult.success) {
      console.error("Failed to send email:", emailResult.error);
    }

    if (userAttempts) {
      userAttempts.count++;
    } else {
      resendAttempts.set(userId, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW,
      });
    }

    const remainingResends = MAX_RESENDS_PER_HOUR - (userAttempts?.count || 1);

    return NextResponse.json({
      success: true,
      message: "New verification code sent successfully",
      expiresIn: "10 minutes",
      remainingResends,
    });
  } catch (error) {
    console.error("Error in resend-verification:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
