import { GET, POST } from "../../src/api/gifts/metadata/route";
import { getAuthPayload } from "../../src/lib/auth-session";
import {
  findGiftMetadataByContractId,
  upsertGiftMetadata,
} from "../../src/server/db/giftMetadataRepository";
import { NextRequest } from "next/server";

jest.mock("../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("../../src/server/db/giftMetadataRepository", () => ({
  findGiftMetadataByContractId: jest.fn(),
  upsertGiftMetadata: jest.fn(),
}));

const mockFind = findGiftMetadataByContractId as jest.Mock;
const mockUpsert = upsertGiftMetadata as jest.Mock;
const mockAuth = getAuthPayload as jest.Mock;

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/gifts/metadata", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function getRequest(contractGiftId?: string) {
  const url = contractGiftId
    ? `http://localhost:3000/api/gifts/metadata?contractGiftId=${contractGiftId}`
    : "http://localhost:3000/api/gifts/metadata";
  return new NextRequest(url, { method: "GET" });
}

const record = {
  id: "meta-1",
  contractGiftId: "42",
  userId: "user-1",
  message: "Happy birthday!",
  hideAmount: false,
  stayAnonymous: true,
  imageUrl: "https://example.com/gift.png",
  processingFee: 0.5,
  status: "indexed",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

describe("POST /api/gifts/metadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(postRequest({ contractGiftId: "42" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when contractGiftId is missing", async () => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    const res = await POST(postRequest({ message: "hi" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid status value", async () => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    const res = await POST(
      postRequest({ contractGiftId: "42", status: "bogus" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-URL imageUrl", async () => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    const res = await POST(
      postRequest({ contractGiftId: "42", imageUrl: "not-a-url" }),
    );
    expect(res.status).toBe(400);
  });

  it("indexes new metadata and returns 201", async () => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    mockFind.mockResolvedValue(null);
    mockUpsert.mockResolvedValue(record);

    const res = await POST(
      postRequest({
        contractGiftId: "42",
        message: "Happy birthday!",
        stayAnonymous: true,
        imageUrl: "https://example.com/gift.png",
        processingFee: 0.5,
        status: "indexed",
      }),
    );

    expect(res.status).toBe(201);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        contractGiftId: "42",
        userId: "user-1",
        message: "Happy birthday!",
        stayAnonymous: true,
      }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.contractGiftId).toBe("42");
  });

  it("updates existing metadata owned by the same user and returns 200", async () => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    mockFind.mockResolvedValue(record);
    mockUpsert.mockResolvedValue({ ...record, message: "Updated" });

    const res = await POST(
      postRequest({ contractGiftId: "42", message: "Updated" }),
    );

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalled();
  });

  it("returns 409 when the contract gift is already indexed by another user", async () => {
    mockAuth.mockResolvedValue({ userId: "user-2" });
    mockFind.mockResolvedValue(record);

    const res = await POST(postRequest({ contractGiftId: "42" }));

    expect(res.status).toBe(409);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/gifts/metadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(getRequest("42"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when contractGiftId is missing", async () => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    const res = await GET(getRequest());
    expect(res.status).toBe(400);
  });

  it("returns the metadata record for the owner", async () => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    mockFind.mockResolvedValue(record);

    const res = await GET(getRequest("42"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.contractGiftId).toBe("42");
    expect(body.data.message).toBe("Happy birthday!");
  });

  it("returns 404 when metadata belongs to another user", async () => {
    mockAuth.mockResolvedValue({ userId: "user-2" });
    mockFind.mockResolvedValue(record);

    const res = await GET(getRequest("42"));

    expect(res.status).toBe(404);
  });

  it("returns 404 when no metadata exists", async () => {
    mockAuth.mockResolvedValue({ userId: "user-1" });
    mockFind.mockResolvedValue(null);

    const res = await GET(getRequest("999"));

    expect(res.status).toBe(404);
  });
});
