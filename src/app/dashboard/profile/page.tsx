"use client";
import { useState } from "react";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { GiftInfoCard } from "@/components/dashboard/dashboard/GiftInfoCard";
import { KycCard } from "@/components/dashboard/dashboard/KycCard";

function Profile() {
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  return (
    <div className="p-6 rounded-4xl min-h-screen bg-[#F7F7FC] flex flex-col gap-6 xl:flex-row">
      <div className="p-10 rounded-4xl bg-white w-full md:max-w-192.5 flex flex-col gap-12.5">
        <p className="text-[#18181B] font-medium text-2xl leading-8">Profile</p>

        {/* Personal Information */}

        <ProfileForm />

        <div className="space-y-12">
          <div className="gap-4.5 flex md:justify-between md:items-end flex-col md:flex-row">
            <div className="space-y-2 ">
              <p className="text-base font-semibold leading-6 tracking-[0%] text-[#3F3F3F] ">
                Password
              </p>
              <p className="text-sm leading-5 text-[#8F8F8F]">
                Update your personal details and manage your public profile.
              </p>
            </div>
            <button className="text-[#5A42DE] border-[#5A42DE] border px-3 w-47.25 rounded-lg font-medium h-10 cursor-pointer py-2">
              Change password
            </button>
          </div>
          <div className="gap-4.5 flex md:justify-between md:items-end flex-col md:flex-row">
            <div className="space-y-2">
              <p className="text-base font-semibold leading-6 tracking-[0%] text-[#3F3F3F] ">
                2 Factor Authentication
              </p>
              <p className="text-sm leading-5 text-[#8F8F8F]">
                Turn on 2FA to add an extra layer of security to your account.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={twoFAEnabled}
              onClick={() => setTwoFAEnabled(!twoFAEnabled)}
              className={`relative inline-flex min-h-8!  min-w-14.25! w-14.25 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5A42DE] ${
                twoFAEnabled ? "bg-[#5A42DE]" : "bg-[#E5E7EB]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6  rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
                  twoFAEnabled ? "translate-x-6.75" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          <div className="gap-4.5 flex md:justify-between md:items-end flex-col md:flex-row">
            <div className="space-y-2 max-w-121.25">
              <p className="text-base font-semibold leading-6 tracking-[0%] text-[#3F3F3F] ">
                Delete account
              </p>
              <p className="text-sm leading-5 text-[#8F8F8F]">
                Deleting this account means you will lose this account and also
                the unclaimed gift with it
              </p>
            </div>
            <button className="text-[#EF4444] border-[#EF4444] border px-3 max-w-47.25 w-47.25 rounded-lg font-medium h-10 cursor-pointer py-2 flex gap-2 items-center flex-1  text-nowrap ">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M21 5.98047C17.67 5.65047 14.32 5.48047 10.98 5.48047C9 5.48047 7.02 5.58047 5.04 5.78047L3 5.98047"
                  stroke="#EF4444"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.5 4.97L8.72 3.66C8.88 2.71 9 2 10.69 2H13.31C15 2 15.13 2.75 15.28 3.67L15.5 4.97"
                  stroke="#EF4444"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M18.8499 9.14062L18.1999 19.2106C18.0899 20.7806 17.9999 22.0006 15.2099 22.0006H8.7899C5.9999 22.0006 5.9099 20.7806 5.7999 19.2106L5.1499 9.14062"
                  stroke="#EF4444"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10.3301 16.5H13.6601"
                  stroke="#EF4444"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 12.5H14.5"
                  stroke="#EF4444"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Delete account
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="flex flex-col gap-4 w-full md:flex-row xl:max-w-86.25">
        <div>
          <GiftInfoCard />
        </div>
        <div>
          <KycCard />
        </div>
      </div>
    </div>
  );
}
export default Profile;
