import { POST } from "../../src/api/gifts/appreciate/route";
import { getAuthPayload } from "../../src/lib/auth-session";
import { sendAppreciationEmailToSender } from "../../src/server/services/emailService";
import { NextRequest } from "next/server";

jest.mock("../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("../../src/server/services/emailService", () => ({
  sendAppreciationEmailToSender: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock("../../src/lib/db", () => {
  const mockGifts: any[] = [];
  const mockUsers: any[] = [];
  const mockUpdateSet = jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue(undefined),
  });
  const mockUpdate = jest.fn().mockReturnValue({ set: mockUpdateSet });
  const mockInsertValues = jest.fn().mockResolvedValue([]);
  const mockTransaction = jest.fn(async (cb: any) =>
    cb({
      update: mockUpdate,
      insert: jest.fn().mockReturnValue({ values: mockInsertValues }),
    }),
  );

  return {
    db: {
      query: {
        gifts: { findFirst: jest.fn(async () => mockGifts[0] || null) },
        users: { findFirst: jest.fn(async () => mockUsers[0] || null) },
      },
      insert: jest.fn().mockReturnValue({ values: mockInsertValues }),
      update: mockUpdate,
      transaction: mockTransaction,
    },
    __mockGifts: mockGifts,
    __mockUsers: mockUsers,
    __mockUpdate: mockUpdate,
    __mockUpdateSet: mockUpdateSet,
    __mockInsertValues: mockInsertValues,
  };
});

describe("POST /api/gifts/:id/appreciate", () => {
  const mockGetAuthPayload = getAuthPayload as jest.Mock;
  const mockSendEmail = sendAppreciationEmailToSender as jest.Mock;
  const mod: any = require("../../src/lib/db");
  const { __mockGifts, __mockUsers, __mockUpdate, __mockUpdateSet, __mockInsertValues } = mod;

  beforeEach(() => {
    jest.clearAllMocks();
    __mockGifts.length = 0;
    __mockUsers.length = 0;
  });

  it("should return 401 Unauthorized if not logged in", async () => {
    mockGetAuthPayload.mockResolvedValue(null);
    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ message: "Thank you!" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(401);
  });

  it("should return 400 Bad Request if neither message, template, nor reaction is provided", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "recipient-user" });
    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(400);
  });

  it("should return 400 Bad Request if reaction is not in the allowed set", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "recipient-user" });
    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ reaction: "not_a_reaction" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(400);
  });

  it("should return 403 Forbidden if logged in user is not recipient", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "wrong-user" });
    __mockGifts.push({
      id: "gift-1",
      recipientId: "recipient-user",
      senderId: "sender-user",
      senderEmail: "sender@example.com",
      status: "completed",
      amount: 100,
      currency: "USDC",
    });
    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ message: "Thanks so much!" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(403);
  });

  it("should return 400 if gift status is not completed", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "recipient-user" });
    __mockGifts.push({
      id: "gift-1",
      recipientId: "recipient-user",
      senderId: "sender-user",
      senderEmail: "sender@example.com",
      status: "pending_otp",
      amount: 100,
      currency: "USDC",
    });
    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ message: "Thanks!" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toMatch(/completed/i);
  });

  it("should successfully deliver appreciation email and persist appreciation to gift record", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "recipient-user" });
    __mockGifts.push({
      id: "gift-1",
      recipientId: "recipient-user",
      senderId: "sender-user",
      senderEmail: "sender@example.com",
      senderName: "Alice",
      status: "completed",
      amount: 100,
      currency: "USDC",
    });
    __mockUsers.push({
      id: "recipient-user",
      name: "Bob",
      email: "bob@example.com",
    });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ message: "Thank you for the wonderful gift!" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        senderEmail: "sender@example.com",
        message: "Thank you for the wonderful gift!",
      }),
    );
    expect(__mockUpdate).toHaveBeenCalled();
    expect(__mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        appreciationMessage: "Thank you for the wonderful gift!",
        appreciationReaction: null,
      }),
    );
  });

  it("should accept reaction-only appreciation and persist reaction without message", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "recipient-user" });
    __mockGifts.push({
      id: "gift-1",
      recipientId: "recipient-user",
      senderId: "sender-user",
      senderEmail: "sender@example.com",
      status: "completed",
      amount: 50,
      currency: "USDC",
    });
    __mockUsers.push({ id: "recipient-user", name: "Bob" });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ reaction: "heart" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(200);
    expect(__mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        appreciationMessage: null,
        appreciationReaction: "heart",
      }),
    );

    // The internal reaction code must never reach the user: notification,
    // response body and email all carry the human-readable label instead.
    const notification = __mockInsertValues.mock.calls[0][0];
    expect(notification.message).toBe("Bob reacted to your gift with ❤️ Heart");
    expect(notification.message).not.toMatch(/reaction:/);
    const body = await res.json();
    expect(body.data.appreciation).toBe("Reacted with ❤️ Heart");
    expect(body.data.reaction).toBe("heart");
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ message: null, template: null, reaction: "❤️ Heart" }),
    );
  });

  it("should deliver message and reaction together", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "recipient-user" });
    __mockGifts.push({
      id: "gift-1",
      recipientId: "recipient-user",
      senderId: "sender-user",
      senderEmail: "sender@example.com",
      status: "completed",
      amount: 50,
      currency: "USDC",
    });
    __mockUsers.push({ id: "recipient-user", name: "Bob" });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ message: "Thanks!", reaction: "party" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(200);
    expect(__mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ appreciationMessage: "Thanks!", appreciationReaction: "party" }),
    );
    expect(__mockInsertValues.mock.calls[0][0].message).toBe(
      'Bob sent you a thank-you note: "Thanks!" 🎉 Party',
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Thanks!", reaction: "🎉 Party" }),
    );
  });

  it("should return 404 when the gift does not exist", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "recipient-user" });
    const req = new NextRequest("http://localhost:3000/api/gifts/missing/appreciate", {
      method: "POST",
      body: JSON.stringify({ message: "Thanks!" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });
});
