import { SavingsService } from "../src/server/services/savingsService";
import { users, wallets, savingsHistory } from "../src/lib/db/schema";

describe("SavingsService", () => {
  it("records a deposit atomically using a transaction and locking the user row", async () => {
    const userRow = {
      id: "user-123",
      savingsBalance: 10,
      vaultContractId: "C123",
    };

    const lockQuery = jest.fn(() => Promise.resolve([userRow]));
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            for: jest.fn(() => lockQuery()),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn(() => Promise.resolve([{ id: "hist-1" }])),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve()),
        })),
      })),
      query: {
        users: { findFirst: jest.fn() },
        wallets: { findFirst: jest.fn(() => Promise.resolve(null)) },
      },
    } as any;

    const result = await SavingsService.recordDeposit(
      tx,
      "user-123",
      25,
      "USDC",
      "hash-1",
      "C123",
    );

    expect(result.success).toBe(true);
    expect(tx.select).toHaveBeenCalled();
    expect(lockQuery).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledWith(savingsHistory);
    expect(tx.update).toHaveBeenCalled();
  });

  it("records a withdrawal atomically and clamps negative balances to zero", async () => {
    const userRow = {
      id: "user-456",
      savingsBalance: 75,
      vaultContractId: "C456",
    };

    const lockQuery = jest.fn(() => Promise.resolve([userRow]));
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            for: jest.fn(() => lockQuery()),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn(() => Promise.resolve([{ id: "hist-2" }])),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve()),
        })),
      })),
      query: {
        users: { findFirst: jest.fn() },
        wallets: { findFirst: jest.fn(() => Promise.resolve({
          id: "wallet-1",
          userId: "user-456",
          currency: "USDC",
          balance: 90,
        })) },
      },
    } as any;

    const result = await SavingsService.recordWithdrawal(
      tx,
      "user-456",
      100,
      "USDC",
      "hash-2",
      "C456",
    );

    expect(result.success).toBe(true);
    expect(tx.select).toHaveBeenCalled();
    expect(lockQuery).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledWith(savingsHistory);
    expect(tx.update).toHaveBeenCalled();
    expect(tx.update).toHaveBeenCalledWith(users);
  });
});
