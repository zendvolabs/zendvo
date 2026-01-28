import { NextResponse } from "next/server";
import { verifyOTP } from "@/server/services/otpService";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, otp } = body;

    if (!userId || !otp) {
      return NextResponse.json(
        { error: "userId and otp are required" },
        { status: 400 },
      );
    }

    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json(
        { error: "Invalid OTP format. Must be 6 digits." },
        { status: 400 },
      );
    }

    const result = await verifyOTP(userId, otp);

    if (!result.success) {
      let statusCode = 400;
      if (result.message?.includes("expired")) {
        statusCode = 400;
      } else if (
        result.locked ||
        result.message?.includes("Maximum attempts")
      ) {
        statusCode = 429;
      }

      return NextResponse.json(
        {
          success: false,
          error: result.message,
          remainingAttempts: result.remainingAttempts,
        },
        { status: statusCode },
      );
    }

    return NextResponse.json({ success: true, message: result.message });
  } catch (error) {
    console.error("Error in verify-email:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
