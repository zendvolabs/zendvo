import { POST } from "../../src/app/api/auth/send-verification/route";
import { generateOTP, storeOTP } from "../../src/server/services/otpService";
import { sendVerificationEmail } from "../../src/server/services/emailService";
import { PrismaClient } from "@prisma/client";

jest.mock("../../src/server/services/otpService", () => ({
  generateOTP: jest.fn(),
  storeOTP: jest.fn(),
}));
jest.mock("../../src/server/services/emailService", () => ({
  sendVerificationEmail: jest.fn(),
}));

jest.mock("@prisma/client", () => {
  const mPrismaClient = {
    user: {
      findUnique: jest.fn(),
    },
  };
  return { PrismaClient: jest.fn(() => mPrismaClient) };
});

const prisma = new PrismaClient();

describe("POST /api/auth/send-verification", () => {
  const mockRequest = (body: any) =>
    ({
      json: async () => body,
    }) as unknown as Request;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 400 if userId or email is missing", async () => {
    const req = mockRequest({ userId: "123" });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("userId and email are required");
  });

  it("should return 404 if user not found", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const req = mockRequest({ userId: "123", email: "test@example.com" });
    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it("should return 200 if already verified", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "123",
      status: "active",
    });
    const req = mockRequest({ userId: "123", email: "test@example.com" });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe("Email already verified");
  });

  it("should generate OTP, store it, send email and return 200", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "123",
      status: "pending",
    });
    (generateOTP as jest.Mock).mockReturnValue("123456");
    (sendVerificationEmail as jest.Mock).mockResolvedValue({ success: true });

    const req = mockRequest({
      userId: "123",
      email: "test@example.com",
      name: "User",
    });
    const res = await POST(req);
    const json = await res.json();

    expect(generateOTP).toHaveBeenCalled();
    expect(storeOTP).toHaveBeenCalledWith("123", "123456");
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      "test@example.com",
      "123456",
      "User",
    );
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });
});
