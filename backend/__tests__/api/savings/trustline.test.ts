import { NextRequest } from "next/server";
import { POST } from "@/api/savings/trustline/route";
import { db } from "@/lib/db";
import { getAuthPayload } from "@/lib/auth-session";
import { consumeRateLimit } from "@/lib/rate-limiter";
import {
  TrustlineError,
  TrustlineService,
} from "@/lib/stellar/trustline_service";

const mockBuildSponsoredTrustline = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: jest.fn(),
      },
    },
  },
}));

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("@/lib/rate-limiter", () => ({
  consumeRateLimit: jest.fn(),
}));

jest.mock("@/lib/stellar/trustline_service", () => {
  const actual = jest.requireActual("@/lib/stellar/trustline_service");
  return {
    ...actual,
    TrustlineService: jest.fn().mockImplementation(() => ({
      buildSponsoredTrustline: mockBuildSponsoredTrustline,
    })),
  };
});

const STELLAR_ADDRESS =
  "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN";
const VAULT_CONTRACT_ID =
  "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR";

const makeRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/savings/trustline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/savings/trustline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (consumeRateLimit as jest.Mock).mockReturnValue({
      key: "savings-trustline:user-1",
      count: 1,
      limit: 20,
      windowMs: 60_000,
      remaining: 19,
      resetMs: 60_000,
      limited: false,
    });
    (getAuthPayload as jest.Mock).mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      role: "user",
    });
    (db.query.users.findFirst as jest.Mock).mockResolvedValue({
      id: "user-1",
      stellarAddress: STELLAR_ADDRESS,
    });
    mockBuildSponsoredTrustline.mockResolvedValue({
      envelopeXdr: "AAAA-sponsored-envelope",
      networkPassphrase: "Test SDF Network ; September 2015",
      asset: { code: "USDC", issuer: STELLAR_ADDRESS },
      sponsor: STELLAR_ADDRESS,
      account: STELLAR_ADDRESS,
      vaultContractId: VAULT_CONTRACT_ID,
    });
  });

  it("returns 401 when the request is unauthenticated", async () => {
    (getAuthPayload as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeRequest({ vaultContractId: VAULT_CONTRACT_ID }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.title).toBe("Unauthorized");
    expect(mockBuildSponsoredTrustline).not.toHaveBeenCalled();
  });

  it("returns 429 when the per-user rate limit is exceeded", async () => {
    (consumeRateLimit as jest.Mock).mockReturnValue({
      key: "savings-trustline:user-1",
      count: 21,
      limit: 20,
      windowMs: 60_000,
      remaining: 0,
      resetMs: 30_000,
      limited: true,
    });

    const res = await POST(makeRequest({ vaultContractId: VAULT_CONTRACT_ID }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.title).toBe("Too Many Requests");
    expect(mockBuildSponsoredTrustline).not.toHaveBeenCalled();
  });

  it("returns 400 when vaultContractId is missing", async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.detail).toContain("vaultContractId");
  });

  it("returns 400 when vaultContractId is not a contract id", async () => {
    const res = await POST(makeRequest({ vaultContractId: "not-a-contract" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.detail).toContain("Invalid 'vaultContractId'");
    expect(mockBuildSponsoredTrustline).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const request = new NextRequest("http://localhost/api/savings/trustline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    const res = await POST(request);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.detail).toContain("valid JSON");
  });

  it("returns 404 when the authenticated user no longer exists", async () => {
    (db.query.users.findFirst as jest.Mock).mockResolvedValue(undefined);

    const res = await POST(makeRequest({ vaultContractId: VAULT_CONTRACT_ID }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.title).toBe("Not Found");
  });

  it("returns 400 when the user has no registered Stellar address", async () => {
    (db.query.users.findFirst as jest.Mock).mockResolvedValue({
      id: "user-1",
      stellarAddress: null,
    });

    const res = await POST(makeRequest({ vaultContractId: VAULT_CONTRACT_ID }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.detail).toContain("registered Stellar address");
    expect(mockBuildSponsoredTrustline).not.toHaveBeenCalled();
  });

  it("builds a sponsored trustline for the user's registered address", async () => {
    const res = await POST(makeRequest({ vaultContractId: VAULT_CONTRACT_ID }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.envelopeXdr).toBe("AAAA-sponsored-envelope");
    expect(json.data.asset).toEqual({
      code: "USDC",
      issuer: STELLAR_ADDRESS,
    });
    expect(json.data.vaultContractId).toBe(VAULT_CONTRACT_ID);
    expect(TrustlineService).toHaveBeenCalledTimes(1);
    expect(mockBuildSponsoredTrustline).toHaveBeenCalledWith({
      vaultContractId: VAULT_CONTRACT_ID,
      stellarAddress: STELLAR_ADDRESS,
    });
  });

  it("maps a trustline configuration error to a problem response", async () => {
    mockBuildSponsoredTrustline.mockRejectedValue(
      new TrustlineError(
        "STELLAR_SPONSOR_SECRET is not configured.",
        "CONFIGURATION_ERROR",
        500,
      ),
    );

    const res = await POST(makeRequest({ vaultContractId: VAULT_CONTRACT_ID }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.detail).toContain("STELLAR_SPONSOR_SECRET");
  });

  it("maps an unreachable sponsor account to 502", async () => {
    mockBuildSponsoredTrustline.mockRejectedValue(
      new TrustlineError(
        "Unable to load the platform sponsor account from Horizon.",
        "SPONSOR_ACCOUNT_UNAVAILABLE",
        502,
      ),
    );

    const res = await POST(makeRequest({ vaultContractId: VAULT_CONTRACT_ID }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.title).toBe("Bad Gateway");
  });

  it("returns 500 for unexpected failures without leaking details", async () => {
    mockBuildSponsoredTrustline.mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest({ vaultContractId: VAULT_CONTRACT_ID }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.detail).toBe("Failed to create the savings trustline.");
  });
});
