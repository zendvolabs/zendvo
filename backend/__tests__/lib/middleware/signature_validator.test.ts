import { validateRequestSignature } from "@/lib/middleware/signature_validator";
import { verifyAccessToken } from "@/lib/tokens";
import { db } from "@/lib/db";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@stellar/stellar-sdk", () => {
  let shouldVerify = true;
  return {
    Keypair: {
      fromPublicKey: jest.fn(() => ({
        verify: jest.fn((_data: Uint8Array, sig: Uint8Array) => {
          if (sig.length === 0) return false;
          return shouldVerify;
        }),
      })),
    },
    __setShouldVerify: (val: boolean) => {
      shouldVerify = val;
    },
  };
});
const { __setShouldVerify } = jest.requireMock("@stellar/stellar-sdk") as {
  __setShouldVerify: (val: boolean) => void;
};

jest.mock("@/lib/tokens", () => ({
  verifyAccessToken: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock("@/lib/db/schema", () => ({
  users: { id: "id", stellarAddress: "stellarAddress" },
}));

// ── Test helpers ───────────────────────────────────────────────────────────

const SIGNING_KEY = "GANK22UVLM5TQ7LN3K7OZ3GJDYBDYXMX6RVIRZOS3HX2U7SAQ5YJPXLY";
const USER_ID = "user-123";

function mockDbReturns(row: { stellarAddress: string | null } | undefined) {
  (db.select as jest.Mock).mockReturnValue({
    from: () => ({
      where: () => Promise.resolve(row ? [row] : []),
    }),
  });
}

function makeReq(overrides: Partial<any> = {}) {
  const headers: Record<string, string> = {
    "x-signature": "dGVzdHNpZw==", // base64("testsig") -> non-empty, passes mock
    "x-timestamp": String(Math.floor(Date.now() / 1000)),
    authorization: "Bearer valid-token",
    ...(overrides.headers ?? {}),
  };

  const req: any = {
    method: overrides.method ?? "POST",
    originalUrl: overrides.originalUrl ?? "/api/wallet/withdraw",
    header: (name: string) => headers[name.toLowerCase()],
    on: (event: string, cb: (...args: any[]) => void) => {
      if (event === "end") process.nextTick(cb);
      return req;
    },
  };
  return req;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

// ── Tests ────────────────────────────────────────────────────────────────────

// The nonce store is a module-level singleton (deliberately, so replay
// protection works across real requests). That means tests must not share
// a (userId, timestamp, signature) triple by accident, or an earlier test's
// successful call "consumes" the nonce a later test also happens to compute
// via `Date.now()`. Freezing time to a distinct value per test — via a
// counter advanced in `beforeEach` — makes every test's default timestamp
// unique, while tests that *intentionally* test replay (same timestamp,
// same signature, twice) remain unaffected since they only compare against
// themselves.
let fakeNowMs = 1_700_000_000_000;

describe("validateRequestSignature", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __setShouldVerify(true);
    (verifyAccessToken as jest.Mock).mockResolvedValue({ userId: USER_ID });
    mockDbReturns({ stellarAddress: SIGNING_KEY });

    fakeNowMs += 10_000; // advance 10s so every test gets its own timestamp
    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    jest.setSystemTime(fakeNowMs);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls next() for a valid, fresh, correctly signed request", async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await validateRequestSignature(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects when X-Signature header is missing", async () => {
    const req = makeReq({ headers: { "x-signature": undefined as any } });
    delete req.header;
    req.header = (name: string) =>
      name.toLowerCase() === "x-signature"
        ? undefined
        : name.toLowerCase() === "x-timestamp"
          ? String(Math.floor(Date.now() / 1000))
          : "Bearer valid-token";
    const res = makeRes();
    const next = jest.fn();

    await validateRequestSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an expired timestamp", async () => {
    const req = makeReq({
      headers: { "x-timestamp": String(Math.floor(Date.now() / 1000) - 9999) },
    });
    const res = makeRes();
    const next = jest.fn();

    await validateRequestSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("expired") }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when the access token is invalid", async () => {
    (verifyAccessToken as jest.Mock).mockResolvedValue(null);
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await validateRequestSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when the user has no Stellar address on record", async () => {
    mockDbReturns({ stellarAddress: null });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await validateRequestSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature", async () => {
    __setShouldVerify(false);
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await validateRequestSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Invalid signature" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a replayed (duplicate) request", async () => {
    const req1 = makeReq();
    const res1 = makeRes();
    const next1 = jest.fn();
    await validateRequestSignature(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    // Same signature + timestamp + user replayed again
    const req2 = makeReq({
      headers: { "x-timestamp": req1.header("x-timestamp") },
    });
    const res2 = makeRes();
    const next2 = jest.fn();
    await validateRequestSignature(req2, res2, next2);

    expect(res2.status).toHaveBeenCalledWith(401);
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Duplicate") }),
    );
    expect(next2).not.toHaveBeenCalled();
  });
});