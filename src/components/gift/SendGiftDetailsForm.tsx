"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { Eye } from "lucide-react";
import { clsx } from "clsx";
import { PhoneInput } from "@/components/PhoneInput";
import Button from "@/components/Button";
import GiftPreviewModal from "@/components/gift/GiftPreviewModal";

import UserProfile from "@/assets/images/user.png";

const PRESET_AMOUNTS = [5, 10, 50, 100, 200, 500];
const MAX_MESSAGE_LENGTH = 200;

export type GiftContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

export type GiftTemplate = {
  id: string;
  name: string;
};

export type GiftDetailsFormValues = {
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  amount: string;
  currency: string;
  message: string;
  templateId: string;
  hideAmountUntilUnlock: boolean;
  anonymousUntilUnlock: boolean;
  unlockDate: string;
  unlockTime: string;
};

export type SendGiftDetailsFormProps = {
  contacts?: GiftContact[];
  templates?: GiftTemplate[];
  value?: GiftDetailsFormValues;
  onChange?: (val: GiftDetailsFormValues) => void;
  onContinue?: () => void;
  showOptionsOnly?: boolean;
  onBack?: () => void;
};

// Utility functions for Naira formatting
const formatNaira = (value: number): string => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const parseNairaInput = (input: string): number | null => {
  const cleaned = input.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  let numeric = parts[0];
  if (parts.length > 1) {
    numeric += "." + parts.slice(1).join("");
  }
  const parsed = parseFloat(numeric);
  return Number.isNaN(parsed) ? null : parsed;
};

export default function SendGiftDetailsForm({
  contacts,
  templates,
  value,
  onChange,
  onContinue,
  showOptionsOnly = false,
  onBack,
}: SendGiftDetailsFormProps) {
  const [countryCode, setCountryCode] = useState("+234");
  const [phoneNumber, setPhoneNumber] = useState(value?.recipientPhone || "");
  const [recipient, setRecipient] = useState<{
    name: string;
    username: string;
    avatar: string;
  } | null>(null);

  // Amount State (Naira formatting)
  const [rawAmount, setRawAmount] = useState<string>(value?.amount || "");
  const [formattedAmount, setFormattedAmount] = useState<string>("");

  // Delivery Date & Time State
  const [date, setDate] = useState(value?.unlockDate || "");
  const [time, setTime] = useState(value?.unlockTime || "");
  const [dateTimeError, setDateTimeError] = useState("");

  // Options State
  const [hideAmount, setHideAmount] = useState(value?.hideAmountUntilUnlock || false);
  const [message, setMessage] = useState(value?.message || "");

  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Sync with parent component values
  useEffect(() => {
    if (value) {
      setPhoneNumber(value.recipientPhone || "");
      setRawAmount(value.amount || "");
      setDate(value.unlockDate || "");
      setTime(value.unlockTime || "");
      setHideAmount(value.hideAmountUntilUnlock || false);
      setMessage(value.message || "");
    }
  }, [value]);

  // Format raw amount for display
  useEffect(() => {
    if (rawAmount) {
      const num = parseFloat(rawAmount);
      setFormattedAmount(Number.isNaN(num) ? "" : formatNaira(num));
    } else {
      setFormattedAmount("");
    }
  }, [rawAmount]);

  // Notify parent of any change
  useEffect(() => {
    if (onChange) {
      onChange({
        recipientId: value?.recipientId || "",
        recipientName: value?.recipientName || recipient?.name || "",
        recipientEmail: value?.recipientEmail || "",
        recipientPhone: phoneNumber,
        amount: rawAmount,
        currency: "NGN",
        message,
        templateId: value?.templateId || "",
        hideAmountUntilUnlock: hideAmount,
        anonymousUntilUnlock: value?.anonymousUntilUnlock || false,
        unlockDate: date,
        unlockTime: time,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    date,
    hideAmount,
    message,
    phoneNumber,
    rawAmount,
    recipient?.name,
    time,
  ]);

  // 1. Mock Recipient Lookup Logic
  useEffect(() => {
    const cleanedPhone = phoneNumber.replace(/\D/g, "");
    if (cleanedPhone.length >= 10) {
      setRecipient({
        name: "Julaybeeb Abubakar",
        username: "@julaybeeb",
        avatar: UserProfile.src,
      });
    } else {
      setRecipient(null);
    }
  }, [phoneNumber]);

  // 2. Future Date/Time Validation
  useEffect(() => {
    if (date && time) {
      const selectedDateTime = new Date(`${date}T${time}`);
      const now = new Date();
      setDateTimeError(
        selectedDateTime <= now ? "Delivery time must be in the future" : ""
      );
    } else {
      setDateTimeError("");
    }
  }, [date, time]);

  // 3. Validation for the Continue Button
  const isFormValid = showOptionsOnly
    ? !dateTimeError
    : recipient !== null &&
    rawAmount !== "" &&
    parseFloat(rawAmount) > 0 &&
    !dateTimeError;

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseNairaInput(e.target.value);
    setRawAmount(parsed !== null ? parsed.toString() : "");
  };

  const handlePresetClick = (amount: number) => {
    setRawAmount(amount.toString());
  };

  const handleContinue = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      onContinue?.();
    }, 1000);
  };

  return (
    <div className="w-full flex justify-center px-4 py-6 md:py-10">
      <div className="w-full max-w-[400px] rounded-3xl bg-[#FAFAFB] border border-[#EEEEF3] p-5 md:p-6 shadow-sm">
        <h2 className="text-[24px] md:text-[28px] font-semibold text-[#18181B]">
          {showOptionsOnly ? "Gift Options" : "Send a Gift"}
        </h2>
        <p className="text-[13px] text-[#717182] mt-1.5 mb-6">
          {showOptionsOnly
            ? "Configure delivery and wrapper options for your gift."
            : "Enter recipient details and amount to send a gift."}
        </p>

        <div className="space-y-5">
          {/* Recipient Phone Input - Only show in details step */}
          {!showOptionsOnly && (
            <div>
              <PhoneInput
                label="Recipient Phone Number"
                placeholder="e.g. 812 345 6789"
                countryCode={countryCode}
                onCountryCodeChange={setCountryCode}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />

              {/* Contact Card (Renders when recipient is found) */}
              {recipient && (
                <div className="mt-3 flex items-center gap-3 p-3 bg-white border border-[#E5E7EB] rounded-xl shadow-sm transition-all animate-in fade-in slide-in-from-top-2">
                  <Image
                    src={recipient.avatar}
                    alt="Recipient avatar"
                    width={40}
                    height={40}
                    className="rounded-full object-cover border border-[#EEEEF3]"
                  />
                  <div className="flex flex-col">
                    <span className="text-[14px] font-semibold text-[#18181B] leading-none">
                      {recipient.name}
                    </span>
                    <span className="text-[12px] text-[#717182] mt-1">
                      {recipient.username}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Amount Selection - Only show in details step */}
          {!showOptionsOnly && (
            <div>
              <label className="block text-xs text-[#9CA3AF] mb-2 px-1">
                Gift Amount (NGN)
              </label>

              {/* Custom Amount Input with Naira formatting */}
              <input
                type="text"
                placeholder="₦ 0.00"
                value={formattedAmount}
                onChange={handleAmountChange}
                className="w-full px-4 py-3 rounded-lg bg-white border border-[#E5E7EB] text-[#030213] placeholder:text-[#C6C7CF] focus:outline-none focus:ring-2 focus:ring-[#5A42DE]/20 focus:border-[#5A42DE] transition-all mb-3"
              />

              {/* Preset Amount Grid */}
              <div className="grid grid-cols-3 gap-2">
                {PRESET_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors border ${rawAmount === String(preset)
                        ? "bg-[#F1EDFF] border-[#5A42DE] text-[#5A42DE]"
                        : "bg-white border-[#E5E7EB] text-[#717182] hover:bg-gray-50"
                      }`}
                  >
                    ₦{preset}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Delivery Date & Time */}
          <div>
            <label className="block text-xs text-[#9CA3AF] mb-2 px-1">
              Delivery Date & Time (Optional)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#030213] focus:outline-none focus:ring-2 focus:ring-[#5A42DE]/20 focus:border-[#5A42DE]"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#030213] focus:outline-none focus:ring-2 focus:ring-[#5A42DE]/20 focus:border-[#5A42DE]"
              />
            </div>
            {dateTimeError && (
              <p className="mt-1.5 text-[12px] text-red-500">{dateTimeError}</p>
            )}
          </div>

          {/* Hide Amount Toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="hideAmount"
              checked={hideAmount}
              onChange={(e) => setHideAmount(e.target.checked)}
              className="size-4 rounded border-gray-300 text-[#5A42DE] focus:ring-[#5A42DE]"
            />
            <label
              htmlFor="hideAmount"
              className="text-[13px] text-[#18181B] cursor-pointer select-none"
            >
              Hide amount from Recipient
            </label>
          </div>

          {/* Message Textarea */}
          <div>
            <div className="flex justify-between items-end mb-2 px-1">
              <label className="block text-xs text-[#9CA3AF]">
                Message / Note (Optional)
              </label>
              <span
                className={`text-[10px] ${message.length >= MAX_MESSAGE_LENGTH ? "text-red-500" : "text-[#717182]"}`}
              >
                {message.length}/{MAX_MESSAGE_LENGTH}
              </span>
            </div>
            <textarea
              maxLength={MAX_MESSAGE_LENGTH}
              rows={3}
              placeholder="Write a sweet note..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white border border-[#E5E7EB] text-sm text-[#030213] placeholder:text-[#C6C7CF] focus:outline-none focus:ring-2 focus:ring-[#5A42DE]/20 focus:border-[#5A42DE] resize-none"
            />
          </div>

          {/* Preview Link */}
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 text-[13px] text-[#5A42DE] font-medium hover:text-[#4E37CC] transition-colors py-1"
          >
            <Eye size={15} strokeWidth={2} />
            Preview recipient&apos;s view
          </button>

          {/* Submit & Back Buttons */}
          <div className="flex gap-3 mt-2">
            {onBack && (
              <Button
                variant="outline"
                onClick={onBack}
                disabled={isLoading}
                className="flex-1 h-12 rounded-xl text-[15px] font-semibold"
              >
                Back
              </Button>
            )}
            <Button
              onClick={handleContinue}
              disabled={!isFormValid || isLoading}
              isLoading={isLoading}
              className={clsx(
                "h-12 rounded-xl bg-[#5A42DE] hover:bg-[#4E37CC] text-white text-[15px] font-semibold transition-all duration-200 disabled:opacity-50",
                onBack ? "flex-1" : "w-full"
              )}
            >
              Continue
            </Button>
          </div>

          {/* Gift Preview Modal */}
          <GiftPreviewModal
            isOpen={isPreviewOpen}
            onClose={() => setIsPreviewOpen(false)}
            data={{
              recipientName: recipient?.name ?? "",
              amount: rawAmount,
              currency: "NGN",
              message,
              hideAmount,
              unlockDate: date,
              unlockTime: time,
            }}
          />
        </div>
      </div>
    </div>
  );
}