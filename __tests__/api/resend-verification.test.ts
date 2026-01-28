import { POST } from "../../src/app/api/auth/resend-verification/route";
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

describe("POST /api/auth/resend-verification", () => {
  const mockRequest = (body: any) =>
    ({
      json: async () => body,
    }) as unknown as Request;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should send verification if within limit", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-resend-1",
      status: "pending",
    });
    (generateOTP as jest.Mock).mockReturnValue("654321");
    (sendVerificationEmail as jest.Mock).mockResolvedValue({ success: true });

    const req = mockRequest({
      userId: "user-resend-1",
      email: "test@example.com",
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(storeOTP).toHaveBeenCalled();
  });

  it("should rate limit after 3 attempts", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-resend-limit",
      status: "pending",
    });
    (generateOTP as jest.Mock).mockReturnValue("000000");
    (sendVerificationEmail as jest.Mock).mockResolvedValue({ success: true });

    const req = mockRequest({
      userId: "user-resend-limit",
      email: "limit@example.com",
    });

    await POST(req);
    await POST(req);
    await POST(req);

    const res4 = await POST(req);
    const json4 = await res4.json();

    expect(res4.status).toBe(429);
    expect(json4.error).toBe("Rate limit exceeded");
  });
});
