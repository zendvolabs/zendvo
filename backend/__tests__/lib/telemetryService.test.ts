import {
  TelemetryService,
  extractTraceId,
  generateTraceId,
  sanitizeLogData,
} from "@/lib/services/telemetry_service";

describe("TelemetryService", () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("sanitizeLogData", () => {
    it("redacts sensitive object keys", () => {
      const sensitiveObj = {
        userId: "user-123",
        secretKey: "super-secret-123",
        privateKey: "priv-456",
        password: "password123",
        token: "jwt-token-abc",
        nested: {
          authToken: "bearer 123",
          safeField: "safe value",
        },
      };

      const sanitized = sanitizeLogData(sensitiveObj) as Record<string, unknown>;
      expect(sanitized.userId).toBe("user-123");
      expect(sanitized.secretKey).toBe("[REDACTED]");
      expect(sanitized.privateKey).toBe("[REDACTED]");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.token).toBe("[REDACTED]");
      expect((sanitized.nested as Record<string, unknown>).authToken).toBe("[REDACTED]");
      expect((sanitized.nested as Record<string, unknown>).safeField).toBe("safe value");
    });

    it("redacts Stellar secret seed keys in string values and error messages", () => {
      // 56-char Stellar secret seed starting with S
      const stellarSecret = "SCZANGBA5YHTNYVVV4C3U252E2B6P6IRKDIOINZCAHSMXFDSTVO563OI";
      const sensitiveText = `Failed with key ${stellarSecret} on network`;

      const sanitized = sanitizeLogData(sensitiveText) as string;
      expect(sanitized).not.toContain(stellarSecret);
      expect(sanitized).toContain("[REDACTED_STELLAR_SECRET]");

      const err = new Error(`Error with secret: ${stellarSecret}`);
      const sanitizedErr = sanitizeLogData(err) as { message: string };
      expect(sanitizedErr.message).not.toContain(stellarSecret);
      expect(sanitizedErr.message).toContain("[REDACTED_STELLAR_SECRET]");
    });

    it("handles circular references gracefully", () => {
      const circularObj: Record<string, unknown> = { name: "test" };
      circularObj.self = circularObj;

      const sanitized = sanitizeLogData(circularObj) as Record<string, unknown>;
      expect(sanitized.name).toBe("test");
      expect(sanitized.self).toBe("[CIRCULAR]");
    });
  });

  describe("extractTraceId and generateTraceId", () => {
    it("generates a non-empty trace ID", () => {
      const traceId = generateTraceId();
      expect(typeof traceId).toBe("string");
      expect(traceId.length).toBeGreaterThan(0);
    });

    it("extracts trace ID from request headers", () => {
      const mockReq = {
        headers: {
          get: (header: string) => {
            if (header === "x-trace-id") return "trace-abc-123";
            return null;
          },
        },
      };

      const extracted = extractTraceId(mockReq);
      expect(extracted).toBe("trace-abc-123");
    });

    it("extracts correlation ID from plain headers object", () => {
      const mockReq = {
        headers: {
          "x-correlation-id": "correlation-xyz",
        },
      };

      const extracted = extractTraceId(mockReq);
      expect(extracted).toBe("correlation-xyz");
    });

    it("generates a new trace ID if headers are missing", () => {
      const extracted = extractTraceId({});
      expect(typeof extracted).toBe("string");
      expect(extracted.length).toBeGreaterThan(0);
    });
  });

  describe("startTimer", () => {
    it("returns elapsed time in milliseconds", async () => {
      const timer = TelemetryService.startTimer();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const elapsed = timer();
      expect(elapsed).toBeGreaterThanOrEqual(15);
    });
  });

  describe("XDR Generation Lifecycle Logging", () => {
    it("logs XDR generation start, success, and failure with structured JSON", () => {
      TelemetryService.logXdrGenerationStart({
        traceId: "test-trace",
        userId: "user-1",
        transactionType: "deposit",
        amount: "50.00",
        currency: "USDC",
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const startLog = JSON.parse(logSpy.mock.calls[0][0]);
      expect(startLog.event).toBe("savings.xdr_generation.started");
      expect(startLog.stage).toBe("xdr_generation");
      expect(startLog.status).toBe("started");
      expect(startLog.userId).toBe("user-1");
      expect(startLog.amount).toBe("50.00");

      TelemetryService.logXdrGenerationSuccess({
        traceId: "test-trace",
        userId: "user-1",
        transactionType: "deposit",
        amount: "50.00",
        currency: "USDC",
        stellarAddress: "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN",
        txHash: "a".repeat(64),
        durationMs: 120,
      });

      expect(logSpy).toHaveBeenCalledTimes(2);
      const successLog = JSON.parse(logSpy.mock.calls[1][0]);
      expect(successLog.event).toBe("savings.xdr_generation.completed");
      expect(successLog.stage).toBe("xdr_generation");
      expect(successLog.status).toBe("completed");
      expect(successLog.durationMs).toBe(120);

      TelemetryService.logXdrGenerationFailure({
        traceId: "test-trace",
        userId: "user-1",
        transactionType: "deposit",
        error: new Error("Simulation failed"),
        errorCode: "UPSTREAM_ERROR",
        durationMs: 250,
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const failureLog = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(failureLog.event).toBe("savings.xdr_generation.failed");
      expect(failureLog.stage).toBe("xdr_generation");
      expect(failureLog.status).toBe("failed");
      expect(failureLog.errorCode).toBe("UPSTREAM_ERROR");
      expect(failureLog.errorMessage).toBe("Simulation failed");
    });
  });

  describe("Network Submission Lifecycle Logging", () => {
    it("logs submission start, success, and failure with structured JSON", () => {
      TelemetryService.logSubmissionStart({
        traceId: "test-trace",
        userId: "user-1",
        stellarAddress: "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN",
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const startLog = JSON.parse(logSpy.mock.calls[0][0]);
      expect(startLog.event).toBe("savings.network_submission.started");
      expect(startLog.stage).toBe("network_submission");
      expect(startLog.status).toBe("started");

      TelemetryService.logSubmissionSuccess({
        traceId: "test-trace",
        userId: "user-1",
        stellarAddress: "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN",
        txHash: "b".repeat(64),
        attempts: 2,
        durationMs: 340,
      });

      expect(logSpy).toHaveBeenCalledTimes(2);
      const successLog = JSON.parse(logSpy.mock.calls[1][0]);
      expect(successLog.event).toBe("savings.network_submission.completed");
      expect(successLog.attempts).toBe(2);

      TelemetryService.logSubmissionFailure({
        traceId: "test-trace",
        userId: "user-1",
        stellarAddress: "GDWF77422SKLZTBQT77BQEQLCIQY6PFTFZX5OFJTLAFFWJ2PK5WBOZAN",
        error: "Horizon rejected transaction",
        errorCode: 400,
        attempts: 3,
        durationMs: 400,
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const failLog = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(failLog.event).toBe("savings.network_submission.failed");
      expect(failLog.errorCode).toBe(400);
      expect(failLog.errorMessage).toBe("Horizon rejected transaction");
    });
  });

  describe("Transaction Confirmation Lifecycle Logging", () => {
    it("logs confirmation success and failure with structured JSON", () => {
      TelemetryService.logConfirmationSuccess({
        userId: "user-1",
        transactionType: "deposit",
        amount: 50,
        currency: "USDC",
        vaultContractId: "CV123",
        txHash: "c".repeat(64),
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const successLog = JSON.parse(logSpy.mock.calls[0][0]);
      expect(successLog.event).toBe("savings.transaction_confirmation.completed");
      expect(successLog.stage).toBe("transaction_confirmation");

      TelemetryService.logConfirmationFailure({
        userId: "user-1",
        transactionType: "withdrawal",
        amount: 10,
        currency: "USDC",
        vaultContractId: "CV123",
        errorCode: "ON_CHAIN_FAILURE",
        error: "Out of gas",
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const failLog = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(failLog.event).toBe("savings.transaction_confirmation.failed");
      expect(failLog.errorCode).toBe("ON_CHAIN_FAILURE");
    });
  });
});
