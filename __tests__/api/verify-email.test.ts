import { POST } from "../../src/app/api/auth/verify-email/route";
import { verifyOTP } from "../../src/server/services/otpService";

jest.mock("../../src/server/services/otpService", () => ({
  verifyOTP: jest.fn(),
}));

describe("POST /api/auth/verify-email", () => {
  const mockRequest = (body: any) =>
    ({
      json: async () => body,
    }) as unknown as Request;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 400 if missing fields", async () => {
    const req = mockRequest({ userId: "123" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 for invalid OTP format", async () => {
    const req = mockRequest({ userId: "123", otp: "abc" });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid OTP format");
  });

  it("should return success if verification succeeds", async () => {
    (verifyOTP as jest.Mock).mockResolvedValue({
      success: true,
      message: "OK",
    });
    const req = mockRequest({ userId: "123", otp: "123456" });
    const res = await POST(req);
    const json = await res.json();

    expect(verifyOTP).toHaveBeenCalledWith("123", "123456");
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("should return 400 if expired", async () => {
    (verifyOTP as jest.Mock).mockResolvedValue({
      success: false,
      message: "expired",
    });
    const req = mockRequest({ userId: "123", otp: "123456" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 429 if locked out", async () => {
    (verifyOTP as jest.Mock).mockResolvedValue({
      success: false,
      locked: true,
      message: "Maximum attempts",
    });
    const req = mockRequest({ userId: "123", otp: "123456" });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });
});
