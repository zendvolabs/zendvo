import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();

export function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export async function storeOTP(userId: string, otp: string) {
  const saltRounds = 10;
  const otpHash = await bcrypt.hash(otp, saltRounds);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.emailVerification.updateMany({
    where: { userId, isUsed: false },
    data: { isUsed: true },
  });

  return await prisma.emailVerification.create({
    data: {
      userId,
      otpHash,
      expiresAt,
      attempts: 0,
      isUsed: false,
    },
  });
}

export async function verifyOTP(userId: string, otp: string) {
  const verification = await prisma.emailVerification.findFirst({
    where: { userId, isUsed: false },
    orderBy: { createdAt: "desc" },
  });

  if (!verification) {
    return {
      success: false,
      message: "No verification code found. Please request a new one.",
    };
  }

  if (new Date() > verification.expiresAt) {
    return {
      success: false,
      message: "Verification code has expired. Please request a new one.",
    };
  }

  if (verification.attempts >= 5) {
    return {
      success: false,
      message: "Maximum attempts exceeded. Please request a new code.",
      locked: true,
    };
  }

  const isValid = await bcrypt.compare(otp, verification.otpHash);

  if (!isValid) {
    await prisma.emailVerification.update({
      where: { id: verification.id },
      data: { attempts: verification.attempts + 1 },
    });

    const remainingAttempts = 5 - (verification.attempts + 1);
    return {
      success: false,
      message: `Invalid verification code. ${remainingAttempts} attempts remaining.`,
      remainingAttempts,
    };
  }

  await prisma.emailVerification.update({
    where: { id: verification.id },
    data: { isUsed: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { status: "active" },
  });

  return { success: true, message: "Email verified successfully!" };
}

export async function cleanupExpiredOTPs() {
  const deleted = await prisma.emailVerification.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      ],
    },
  });
  return deleted.count;
}
