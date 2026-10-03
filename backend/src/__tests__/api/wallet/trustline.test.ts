import { NextRequest } from "next/server";
import { POST } from "@/api/wallet/trustline";
import { getAuthPayload } from "@/lib/auth-session";
import { TrustlineService } from "@/lib/stellar/trustline_service";

const VALID_STELLAR_ADDRESS = "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN";

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("@/lib/db", () => {
  const selectWhere = jest.fn();
  return {
    db: {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: selectWhere,
        })),
      })),
    },
    __mocks: { selectWhere },
  };
});

jest.mock("@/lib/stellar/trustline_service", () => ({
  TrustlineService: {
    buildSponsoredUsdcTrustlineXdr: jest.fn(),
  },
}));

const mockGetAuthPayload = getAuthPayload as jest.Mock;
const mockBuildXdr = (
  TrustlineService as jest.Mocked<typeof TrustlineService>
).buildSponsoredUsdcTrustlineXdr as jest.Mock;
const { __mocks } = require("@/lib/db");

function makeRequest() {
  return new NextRequest("http://localhost/api/wallet/trustline", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer token",
    },
  });
}

describe("POST /api/wallet/trustline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when there is no auth payload", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.title).toBe("Unauthorized");
  });

  it("returns 400 when the user has no registered Stellar address", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    __mocks.selectWhere.mockResolvedValueOnce([{ stellarAddress: null }]);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.detail).toContain("No Stellar address registered");
  });

  it("returns 400 when the user lookup returns no rows", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    __mocks.selectWhere.mockResolvedValueOnce([]);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.detail).toContain("No Stellar address registered");
  });

  it("returns 200 with the XDR when the service succeeds", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    __mocks.selectWhere.mockResolvedValueOnce([
      { stellarAddress: VALID_STELLAR_ADDRESS },
    ]);
    mockBuildXdr.mockResolvedValueOnce("AAAAAgAAAAB-mock-xdr");

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.xdr).toBe("AAAAAgAAAAB-mock-xdr");
    expect(mockBuildXdr).toHaveBeenCalledWith(VALID_STELLAR_ADDRESS);
  });

  it("returns 500 with the error message when the service throws", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    __mocks.selectWhere.mockResolvedValueOnce([
      { stellarAddress: VALID_STELLAR_ADDRESS },
    ]);
    mockBuildXdr.mockRejectedValueOnce(new Error("Horizon unreachable"));

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.title).toBe("Internal Server Error");
    expect(body.detail).toBe("Horizon unreachable");
  });

  it("returns 500 with a generic message when the error has no message", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    __mocks.selectWhere.mockResolvedValueOnce([
      { stellarAddress: VALID_STELLAR_ADDRESS },
    ]);
    mockBuildXdr.mockRejectedValueOnce({});

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.detail).toBe(
      "Failed to build sponsored trustline transaction",
    );
  });

  it("returns 500 when the DB lookup throws", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-1" });
    __mocks.selectWhere.mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.title).toBe("Internal Server Error");
  });
});
