"use client";

import React, { useState } from "react";
import Button from "@/components/Button";
import { PasswordInput } from "@/components/PasswordInput";

export const SecuritySettings = () => {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  return (
    <section className="w-full max-w-[475px] rounded-4xl bg-white px-6 py-8 shadow-sm sm:px-9 sm:py-10">
      <div className="mb-6 space-y-2">
        <h1 className="text-[28px] font-medium leading-9 text-[#18181B]">
          Change password
        </h1>
        <p className="max-w-sm text-base leading-6 text-[#18181B]">
          Update your password and manage two-factor authentication for your
          account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-6">
          <PasswordInput
            id="current-password"
            name="currentPassword"
            label="Current password"
            autoComplete="current-password"
            required
          />
          <PasswordInput
            id="new-password"
            name="newPassword"
            label="New password"
            autoComplete="new-password"
            required
          />
          <PasswordInput
            id="confirm-new-password"
            name="confirmNewPassword"
            label="Confirm new password"
            autoComplete="new-password"
            required
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-[#E5E7EB] px-4 py-3.5">
          <div>
            <p className="text-sm font-medium text-[#18181B]">Enable 2FA</p>
            <p className="mt-1 text-xs leading-5 text-[#717182]">
              Require an extra verification step when signing in.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={twoFactorEnabled}
            onClick={() => setTwoFactorEnabled((enabled) => !enabled)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#5A45FE]/30 focus:ring-offset-2 ${
              twoFactorEnabled ? "bg-[#5A45FE]" : "bg-[#E5E7EB]"
            }`}
          >
            <span
              className={`absolute top-1 size-5 rounded-full bg-white shadow transition-transform ${
                twoFactorEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <Button
          type="submit"
          size="lg"
          className="h-[52px] w-full rounded-lg text-base font-medium"
        >
          Change password
        </Button>
      </form>
    </section>
  );
};
