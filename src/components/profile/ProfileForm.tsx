"use client";

import { useState, useRef, ChangeEvent } from "react";
import Image from "next/image";
import { Input } from "@/components/Input";
import { PhoneInput } from "@/components/PhoneInput";
import Button from "@/components/Button";

interface ProfileData {
  fullName: string;
  email: string;
  phone: string;
  countryCode: string;
}

const CameraIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export const ProfileForm = () => {
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData>({
    fullName: "",
    email: "",
    phone: "",
    countryCode: "+234",
  });
  const [draft, setDraft] = useState<ProfileData>(profile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("File is too large. Max 10MB.");
      e.target.value = "";
      return;
    }
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file.");
      return;
    }
    const url = URL.createObjectURL(file);
    setAvatarSrc(url);
  };

  const handleSave = () => {
    setProfile(draft);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Avatar */}
      <div className="relative w-20 h-20">
        <div className="w-20 h-20 rounded-full overflow-hidden! bg-[#E5E7EB] border-2 border-white shadow ">
          {avatarSrc ? (
            <Image
              src={avatarSrc}
              alt="Profile avatar"
              width={80}
              height={80}
              className="object-cover size-full"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#5A45FE]/10 text-[#5A45FE] text-2xl font-semibold">
              {profile.fullName ? profile.fullName[0].toUpperCase() : ""}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Upload avatar"
          className="absolute bottom-0 right-0  min-w-0! min-h-0! rounded-full bg-[#5A45FE] text-white flex items-center justify-center shadow hover:bg-[#4b35e5] transition-colors"
        >
          <CameraIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          className="hidden"
        />
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col md:flex-row gap-8 md:gap-12">
        {/* Left: info */}
        <div className="flex flex-col gap-2 md:w-66.5 shrink-0">
          <p className="text-base font-semibold text-[#18181B]">
            Personal Information
          </p>
          <p className="text-sm text-[#717182] leading-5">
            Update your personal details and manage your public profile.
          </p>
          <p className="text-sm text-[#8F8F8F]">
            -Account created on{" "}
            <span className="font-bold text-[#5A42DE]">
              12 Dec 2026, 8:27pm
            </span>{" "}
          </p>
        </div>

        {/* Right: fields */}
        <div className="flex flex-col gap-5 flex-1">
          <div className="relative pt-2">
            <Input
              id="fullName"
              label="Full Name"
              value={draft.fullName}
              onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
              placeholder="Enter your full name"
            />
          </div>
          <PhoneInput
            id="phone"
            label="Phone number"
            value={draft.phone}
            countryCode={draft.countryCode}
            onCountryCodeChange={(code) =>
              setDraft({ ...draft, countryCode: code })
            }
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="81 123 456 78"
          />
          <div className="relative pt-2">
            <Input
              id="email"
              label="Email address"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="Enter your email"
            />
          </div>
          <div>
            <Button onClick={handleSave} className="rounded-lg">
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
