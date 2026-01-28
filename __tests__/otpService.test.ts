import {
  generateOTP,
  storeOTP,
  verifyOTP,
  cleanupExpiredOTPs,
} from "../src/server/services/otpService";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

jest.mock("@prisma/client", () => {
  const mPrismaClient = {
    emailVerification: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
  };
  return { PrismaClient: jest.fn(() => mPrismaClient) };
});

jest.mock("bcryptjs", () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const prisma = new PrismaClient();

describe("OTP Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("generateOTP", () => {
    it("should generate a 6-digit string", () => {
      const otp = generateOTP();
      expect(otp).toHaveLength(6);
      expect(otp).toMatch(/^\d{6}$/);
    });
  });

  describe("storeOTP", () => {
    it("should hash user OTP and store it in database", async () => {
      const userId = "user-123";
      const otp = "123456";
      const hashedOtp = "hashed-otp";
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedOtp);
      (prisma.emailVerification.create as jest.Mock).mockResolvedValue({
        id: "ev-1",
      });

      await storeOTP(userId, otp);

      expect(bcrypt.hash).toHaveBeenCalledWith(otp, 10);
      expect(prisma.emailVerification.updateMany).toHaveBeenCalledWith({
        where: { userId, isUsed: false },
        data: { isUsed: true },
      });
      expect(prisma.emailVerification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          otpHash: hashedOtp,
          attempts: 0,
          isUsed: false,
        }),
      });
    });
  });

  describe("verifyOTP", () => {
    const userId = "user-123";
    const otp = "123456";
    const hashedOtp = "hashed-otp";
    const validVerification = {
      id: "ev-1",
      userId,
      otpHash: hashedOtp,
      expiresAt: new Date(Date.now() + 100000),
      attempts: 0,
      isUsed: false,
      createdAt: new Date(),
    };

    it("should return success for valid OTP", async () => {
      (prisma.emailVerification.findFirst as jest.Mock).mockResolvedValue(
        validVerification,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await verifyOTP(userId, otp);

      expect(result.success).toBe(true);
      expect(prisma.emailVerification.update).toHaveBeenCalledWith({
        where: { id: validVerification.id },
        data: { isUsed: true },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { status: "active" },
      });
    });

    it("should fail if no verification found", async () => {
      (prisma.emailVerification.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await verifyOTP(userId, otp);

      expect(result.success).toBe(false);
      expect(result.message).toContain("No verification code found");
    });

    it("should fail if expired", async () => {
      (prisma.emailVerification.findFirst as jest.Mock).mockResolvedValue({
        ...validVerification,
        expiresAt: new Date(Date.now() - 100000),
      });

      const result = await verifyOTP(userId, otp);

      expect(result.success).toBe(false);
      expect(result.message).toContain("expired");
    });

    it("should fail if max attempts exceeded", async () => {
      (prisma.emailVerification.findFirst as jest.Mock).mockResolvedValue({
        ...validVerification,
        attempts: 5,
      });

      const result = await verifyOTP(userId, otp);

      expect(result.success).toBe(false);
      expect(result.locked).toBe(true);
    });

    it("should increment attempts on invalid OTP", async () => {
      (prisma.emailVerification.findFirst as jest.Mock).mockResolvedValue(
        validVerification,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await verifyOTP(userId, otp);

      expect(result.success).toBe(false);
      expect(prisma.emailVerification.update).toHaveBeenCalledWith({
        where: { id: validVerification.id },
        data: { attempts: 1 },
      });
    });
  });

  describe("cleanupExpiredOTPs", () => {
    it("should delete expired OTPs", async () => {
      (prisma.emailVerification.deleteMany as jest.Mock).mockResolvedValue({
        count: 5,
      });

      const count = await cleanupExpiredOTPs();

      expect(prisma.emailVerification.deleteMany).toHaveBeenCalled();
      expect(count).toBe(5);
    });
  });
});
