"use client";

import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import Button from "@/components/Button";

interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  logoUrl?: string;
}

interface WithdrawalFormProps {
  availableBalance: number;
  currency?: string;
  accounts: BankAccount[];
  onSubmit: (amount: number, accountId: string) => void | Promise<void>;
  isSubmitting?: boolean;
}

const BANK_COLORS: Record<string, string> = {
  "Zenith Bank": "#CC2726",
  "Access Bank": "#E3001B",
  "GTBank": "#F26522",
  "First Bank": "#004C97",
  "UBA": "#FF0000",
  "Stanbic IBTC": "#009FDF",
};

function BankInitial({ bankName, logoUrl }: { bankName: string; logoUrl?: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={bankName} className="w-full h-full object-contain rounded-xl" />
    );
  }

  const color = BANK_COLORS[bankName] ?? "#5A45FE";
  const initials = bankName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="w-full h-full rounded-xl flex items-center justify-center text-white text-[11px] font-bold"
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
}

function formatAmount(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-NG");
}

function parseAmount(formatted: string): number {
  return Number(formatted.replace(/,/g, "")) || 0;
}

const WithdrawalForm: React.FC<WithdrawalFormProps> = ({
  availableBalance,
  currency = "NGN",
  accounts,
  onSubmit,
  isSubmitting = false,
}) => {
  const [amountDisplay, setAmountDisplay] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    accounts[0]?.id ?? "",
  );
  const [amountError, setAmountError] = useState("");

  const parsedAmount = parseAmount(amountDisplay);
  const isAmountValid = parsedAmount > 0 && parsedAmount <= availableBalance;
  const canSubmit = isAmountValid && selectedAccountId && !isSubmitting;

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/,/g, "");
    if (raw && !/^\d*$/.test(raw)) return;
    setAmountDisplay(formatAmount(raw));
    setAmountError("");
  }

  function handleMax() {
    setAmountDisplay(formatAmount(String(availableBalance)));
    setAmountError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsedAmount) {
      setAmountError("Please enter an amount");
      return;
    }
    if (parsedAmount > availableBalance) {
      setAmountError("Amount exceeds available balance");
      return;
    }
    onSubmit(parsedAmount, selectedAccountId);
  }

  const formattedBalance = availableBalance.toLocaleString("en-NG");

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Amount field */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label
            htmlFor="withdrawal-amount"
            className="text-[13px] font-medium text-[#52525B]"
          >
            Amount
          </label>
          <span className="text-[12px] text-[#717182]">
            Balance:{" "}
            <span className="font-semibold text-[#18181B]">
              {currency} {formattedBalance}
            </span>
          </span>
        </div>

        <div
          className={`relative flex items-center border rounded-xl bg-[#FAFAFB] transition-colors ${
            amountError
              ? "border-red-400 focus-within:border-red-500"
              : "border-[#E5E7EB] focus-within:border-[#5A45FE]"
          }`}
        >
          <span className="pl-4 pr-2 text-[15px] font-medium text-[#52525B] select-none">
            {currency}
          </span>
          <input
            id="withdrawal-amount"
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={amountDisplay}
            onChange={handleAmountChange}
            className="flex-1 h-[52px] bg-transparent text-[15px] font-semibold text-[#18181B] placeholder:text-[#9CA3AF] focus:outline-none"
            aria-describedby={amountError ? "amount-error" : undefined}
            aria-invalid={!!amountError}
          />
          <button
            type="button"
            onClick={handleMax}
            className="mr-3 px-3 py-1.5 text-[12px] font-semibold text-[#5A45FE] bg-[#F0EEFF] hover:bg-[#E8E4FF] rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#5A45FE]/40"
          >
            Max
          </button>
        </div>

        {amountError && (
          <p id="amount-error" role="alert" className="mt-1.5 text-[12px] text-red-500">
            {amountError}
          </p>
        )}
      </div>

      {/* Bank account selection */}
      <div className="mb-8">
        <p className="text-[13px] font-medium text-[#52525B] mb-3">
          Select account
        </p>

        {accounts.length === 0 ? (
          <p className="text-[13px] text-[#9CA3AF] text-center py-4">
            No bank accounts added yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Bank accounts">
            {accounts.map((account) => {
              const isSelected = account.id === selectedAccountId;
              return (
                <button
                  key={account.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelectedAccountId(account.id)}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left focus:outline-none focus:ring-2 focus:ring-[#5A45FE]/40 ${
                    isSelected
                      ? "border-[#5A45FE] bg-[#F5F3FF]"
                      : "border-[#E5E7EB] bg-white hover:border-[#C4BCFF] hover:bg-[#FAFAFB]"
                  }`}
                >
                  {/* Bank logo/initials */}
                  <div className="w-10 h-10 shrink-0 overflow-hidden">
                    <BankInitial bankName={account.bankName} logoUrl={account.logoUrl} />
                  </div>

                  {/* Account info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#18181B] truncate">
                      {account.bankName}
                    </p>
                    <p className="text-[12px] text-[#717182]">
                      {account.accountNumber} · {account.accountName}
                    </p>
                  </div>

                  {/* Selection indicator */}
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? "border-[#5A45FE] bg-[#5A45FE]"
                        : "border-[#D1D5DB] bg-white"
                    }`}
                  >
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary row */}
      {isAmountValid && selectedAccountId && (
        <div className="flex items-center justify-between px-4 py-3 bg-[#F7F7FC] rounded-xl mb-6 text-[13px] text-[#52525B]">
          <span>You&apos;ll receive</span>
          <span className="font-bold text-[#18181B]">
            {currency} {amountDisplay}
          </span>
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        isLoading={isSubmitting}
        disabled={!canSubmit}
        className="w-full h-12 rounded-xl text-[15px] font-semibold bg-[#5A45FE] hover:bg-[#4b35e5] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        Withdraw
        {!isSubmitting && <ChevronRight size={16} />}
      </Button>
    </form>
  );
};

export default WithdrawalForm;
