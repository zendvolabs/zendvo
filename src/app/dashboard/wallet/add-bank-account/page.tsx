"use client";

import { AccountDetailsForm } from "@/components/dashboard/accounts/AccountDetailsForm";

export default function AddBankAccountPage() {
  return (
    <main className="flex min-h-[calc(100vh-73px)] items-start justify-center rounded-4xl bg-[#F7F7FC] px-5 py-16 sm:px-8">
      <AccountDetailsForm />
    </main>
  );
}
