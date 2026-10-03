import { NextRequest } from "next/server";
import { POST } from "@/api/transactions/submit";
import { getAuthPayload } from "@/lib/auth-session";
import { SubmissionService } from "@/lib/stellar/submission_service";
import { TelemetryService } from "@/lib/services/telemetry_service";

jest.mock("@/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("@/lib/stellar/submission_service", () => ({
  SubmissionService: {
    submitXdrToNetwork: jest.fn(),
  },
}));

const mockFindUserFirst = jest.fn();
const mockInsertTransactionValues = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: (...args: any[]) => mockFindUserFirst(...args),
      },
    },
    insert: jest.fn(() => ({
      values: (...args: any[]) => mockInsertTransactionValues(...args),
    })),
  },
}));

const mockGetAuthPayload = getAuthPayload as jest.Mock;
const mockSubmitXdrToNetwork = SubmissionService.submitXdrToNetwork as jest.Mock;

function makeRequest(body?: Record<string, unknown>, headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/transactions/submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer token",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/transactions/submit Telemetry Instrumentation", () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(TelemetryService, "logSubmissionSuccess");
    errorSpy = jest.spyOn(TelemetryService, "logSubmissionFailure");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 401 and logs failure when unauthenticated", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const res = await POST(makeRequest({ signedXdr: "AAAA" }));
    expect(res.status).toBe(401);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionType: "blockchain_submission",
        errorCode: 401,
      })
    );
  });

  it("returns 400 and logs failure when signedXdr is missing", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        errorCode: 400,
      })
    );
  });

  it("returns 400 and logs failure when user has no stellar address", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindUserFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ signedXdr: "AAAA" }));
    expect(res.status).toBe(400);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        errorCode: 400,
      })
    );
  });

  it("returns 200 and logs success upon successful network submission", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindUserFirst.mockResolvedValue({
      id: "user-123",
      stellarAddress: "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN",
    });
    mockSubmitXdrToNetwork.mockResolvedValue({
      success: true,
      hash: "a".repeat(64),
      status: "success",
      attempts: 1,
    });
    mockInsertTransactionValues.mockResolvedValue([]);

    const res = await POST(
      makeRequest(
        { signedXdr: "AAAA..." },
        { "x-trace-id": "trace-test-uuid" }
      )
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.hash).toBe("a".repeat(64));

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-test-uuid",
        userId: "user-123",
        transactionType: "blockchain_submission",
        stellarAddress: "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN",
        txHash: "a".repeat(64),
      })
    );
  });

  it("returns 400 and logs failure when network submission fails", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "user-123" });
    mockFindUserFirst.mockResolvedValue({
      id: "user-123",
      stellarAddress: "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN",
    });
    mockSubmitXdrToNetwork.mockResolvedValue({
      success: false,
      error: "tx_bad_seq",
      attempts: 5,
    });

    const res = await POST(makeRequest({ signedXdr: "AAAA..." }));
    expect(res.status).toBe(400);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        transactionType: "blockchain_submission",
        stellarAddress: "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN",
        errorCode: 400,
        error: "tx_bad_seq",
      })
    );
  });
});
