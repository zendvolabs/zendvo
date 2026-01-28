import { sendVerificationEmail } from "../src/server/services/emailService";
import nodemailer from "nodemailer";

jest.mock("nodemailer", () => {
  const sendMailMock = jest.fn();
  const createTransportMock = jest.fn().mockReturnValue({
    sendMail: sendMailMock,
  });
  return {
    createTransport: createTransportMock,
  };
});

describe("Email Service", () => {
  let sendMailMock: jest.Mock;
  const originalEnv = process.env;

  beforeAll(() => {
    const createTransport = nodemailer.createTransport as jest.Mock;
    const transportObj = createTransport.mock.results[0].value;
    sendMailMock = transportObj.sendMail;
  });

  beforeEach(() => {
    if (sendMailMock) sendMailMock.mockClear();
    process.env = { ...originalEnv, NODE_ENV: "production" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should send an email successfully", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    sendMailMock.mockResolvedValue({ messageId: "msg-123" });

    const result = await sendVerificationEmail(
      "test@example.com",
      "123456",
      "TestUser",
    );

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "test@example.com",
        subject: "Verify Your Email - Zendvo",
        html: expect.stringContaining("123456"),
      }),
    );
    expect(result.success).toBe(true);
    logSpy.mockRestore();
  });

  it("should handle email sending failure", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    sendMailMock.mockRejectedValue(new Error("SMTP Error"));

    const result = await sendVerificationEmail("test@example.com", "123456");

    expect(result.success).toBe(false);
    expect(result.error).toBe("SMTP Error");
    errorSpy.mockRestore();
  });

  it("should just log in development mode", async () => {
    process.env = { ...originalEnv, NODE_ENV: "development" };
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    const result = await sendVerificationEmail("test@example.com", "123456");

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("dev-mode");

    consoleSpy.mockRestore();
  });
});
