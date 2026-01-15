/**
 * Paystack API wrapper logic.
 * Handles payouts to Nigerian bank accounts.
 */
export const paystackConfig = {
  baseUrl: "https://api.paystack.co",
  secretKey: process.env.PAYSTACK_SECRET_KEY,
};

export const verifyBankAccount = async (
  accountNumber: string,
  bankCode: string
) => {
  // Logic to call https://api.paystack.co/bank/resolve
  return { status: "mock_verified", name: "Zendvo Recipient" };
};
