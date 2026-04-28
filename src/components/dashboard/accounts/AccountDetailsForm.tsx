"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, Globe2 } from "lucide-react";
import Button from "@/components/Button";
import { Input } from "@/components/Input";

const currencyOptions = [
  { value: "NGN", label: "Nigeria - NGN" },
  { value: "USD", label: "United States - USD" },
  { value: "GBP", label: "United Kingdom - GBP" },
  { value: "EUR", label: "European Union - EUR" },
];

export const AccountDetailsForm = () => {
  const [currency, setCurrency] = useState("NGN");
  const [swiftCode, setSwiftCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  const selectedCurrency = useMemo(
    () => currencyOptions.find((option) => option.value === currency),
    [currency],
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  return (
    <section className="w-full max-w-[475px] rounded-4xl bg-white px-6 py-8 shadow-sm sm:px-9 sm:py-10">
      <div className="mb-7 space-y-2">
        <h1 className="text-[28px] font-medium leading-9 text-[#18181B]">
          Add a bank account
        </h1>
        <p className="text-base leading-6 text-[#18181B]">
          This is where your gift will be sent once you withdraw.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="relative">
          <label
            htmlFor="country-currency"
            className="absolute -top-2.5 left-4 z-10 bg-white px-1 text-[11px] text-[#9CA3AF]"
          >
            Select country / currency
          </label>
          <div className="relative">
            <Globe2 className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#18181B]" />
            <select
              id="country-currency"
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className="h-[52px] w-full appearance-none rounded-lg border border-[#E5E7EB] bg-white px-12 text-sm font-medium text-[#18181B] transition-all focus:border-[#5A45FE] focus:outline-none focus:ring-1 focus:ring-[#5A45FE]"
            >
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-[#9CA3AF]" />
          </div>
        </div>

        <div
          className={`grid gap-6 overflow-hidden transition-all duration-300 ease-out ${
            selectedCurrency
              ? "max-h-72 translate-y-0 opacity-100"
              : "max-h-0 -translate-y-2 opacity-0"
          }`}
        >
          <Input
            id="swift-bic"
            name="swiftBic"
            label="Swift / BIC"
            value={swiftCode}
            onChange={(event) => setSwiftCode(event.target.value)}
            placeholder="Enter Swift or BIC"
            autoComplete="off"
            required
          />
          <Input
            id="account-number"
            name="accountNumber"
            label="Account number"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
            placeholder="Enter account number"
            inputMode="numeric"
            autoComplete="off"
            required
          />
        </div>

        <Button
          type="submit"
          size="lg"
          className="h-[52px] w-full rounded-lg text-base font-medium"
        >
          Continue
        </Button>
      </form>
    </section>
  );
};
