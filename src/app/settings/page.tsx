"use client";

import { SecuritySettings } from "@/components/settings/SecuritySettings";
import { DashboardLayout } from "@/layouts/DashboardLayout";

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <main className="flex min-h-[calc(100vh-73px)] items-start justify-center rounded-4xl bg-[#F7F7FC] px-5 py-16 sm:px-8">
        <SecuritySettings />
      </main>
    </DashboardLayout>
  );
}
