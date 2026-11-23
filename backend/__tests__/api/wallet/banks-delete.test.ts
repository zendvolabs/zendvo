import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { DELETE } from "../../../src/api/wallet/banks/route";
import { getAuthPayload } from "../../../src/lib/auth-session";

jest.mock("../../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("../../../src/lib/db", () => {
  const returning = jest.fn();
  const where = jest.fn(() => ({ returning }));
  return {
    db: { delete: jest.fn(() => ({ where })) },
    __mocks: { where, returning },
  };
});

const { db, __mocks } = jest.requireMock("../../../src/lib/db");
const mockGetAuthPayload = getAuthPayload as jest.Mock;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

function deleteBankAccount(id: string) {
  const req = new NextRequest(`http://localhost:3001/api/wallet/banks/${id}`, {
    method: "DELETE",
    headers: { authorization: "Bearer token" },
  });
  return DELETE(req, { params: Promise.resolve({ id }) });
}

describe("DELETE /api/wallet/banks/:id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthPayload.mockResolvedValue({ userId: USER_ID });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const res = await deleteBankAccount(ACCOUNT_ID);

    expect(res.status).toBe(401);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("returns 400 when the id is not a UUID", async () => {
    const res = await deleteBankAccount("not-a-uuid");

    expect(res.status).toBe(400);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("deletes the account only when it belongs to the caller", async () => {
    __mocks.returning.mockResolvedValue([{ id: ACCOUNT_ID }]);

    const res = await deleteBankAccount(ACCOUNT_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message: "Bank account unlinked successfully",
    });
    const where = new PgDialect().sqlToQuery(__mocks.where.mock.calls[0][0]);
    expect(where.sql).toBe(
      '("bank_accounts"."id" = $1 and "bank_accounts"."user_id" = $2)',
    );
    expect(where.params).toEqual([ACCOUNT_ID, USER_ID]);
  });

  it("returns 404 when no account with that id belongs to the caller", async () => {
    __mocks.returning.mockResolvedValue([]);

    const res = await deleteBankAccount(ACCOUNT_ID);

    expect(res.status).toBe(404);
  });

  it("returns 500 when the database call fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    __mocks.returning.mockRejectedValue(new Error("connection lost"));

    const res = await deleteBankAccount(ACCOUNT_ID);

    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBe("Failed to unlink bank account");
  });
});
