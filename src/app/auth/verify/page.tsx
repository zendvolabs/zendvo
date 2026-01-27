"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { AuthLayout } from "@/layouts/AuthLayout";
import { WorldMapShowcase } from "@/components/auth/WordMapShowcase";
import OTPInput from "@/components/auth/OTPInput";
import Button from "@/components/Button";
import Alert from "@/components/Alert";
import { HelpModal } from "@/components/auth/HelpModal";

export default function VerifyPage() {
  const [timeLeft, setTimeLeft] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendAttempts, setResendAttempts] = useState(0);
  const [otp, setOtp] = useState("");
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else {
      setCanResend(true);
    }
    return () => clearInterval(timer);
  }, [timeLeft]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleResend = async () => {
    if (!canResend || resendAttempts >= 3) return;
    setCanResend(false);
    setResendAttempts((prev) => prev + 1);
    setTimeLeft(60);
    // Add resend API logic here
    console.log("Resending code...");
  };

  const handleVerify = async (codeToVerify?: string) => {
    const code = codeToVerify || otp;
    setNotification(null);
    setIsSubmitting(true);

    if (code.length !== 6) {
      setIsSubmitting(false);
      setNotification({
        type: "error",
        message: "The OTP you entered is incomplete",
      });
      return;
    }

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Simple validation simulation (accept any 6 digits for now except 000000)
    if (code === "000000") {
      setNotification({
        type: "error",
        message: "The OTP you entered is incorrect",
      });
      setIsSubmitting(false);
      return;
    }

    console.log("Verifying code:", code);
    setIsSubmitting(false);
    setNotification({
      type: "success",
      message: "OTP Verification successful",
    });
  };

  const handleOtpChange = (value: string) => {
    setOtp(value);
    if (notification) setNotification(null);
  };

  const handleOtpComplete = (value: string) => {
    setOtp(value);
    // Auto-submit when all 6 digits are entered
    handleVerify(value);
  };

  return (
    <AuthLayout showcaseContent={<WorldMapShowcase />}>
      <div className="w-full flex-1 flex flex-col h-full lg:h-auto">
        <div className="flex-1 lg:flex-none">
          {notification && (
            <div className="mb-6">
              <Alert
                type={notification.type}
                message={notification.message}
                onClose={() => setNotification(null)}
              />
            </div>
          )}
          <h1 className="text-2xl md:text-3xl font-bold text-[#18181B] mb-3">
            Verify your email address
          </h1>
          <p className="text-[#52525B] text-sm md:text-base mb-8">
            Please enter the verification code sent to your email account{" "}
            <span className="font-medium text-[#18181B]">jo***3@gmail.com</span>
          </p>

          <div className="mb-8">
            <OTPInput
              length={6}
              onChange={handleOtpChange}
              onComplete={handleOtpComplete}
              error={notification?.type === "error"}
            />
          </div>
          <div className="w-full flex justify-center mt-6">
            <button
              onClick={handleResend}
              disabled={!canResend || resendAttempts >= 3}
              className={`text-sm ${!canResend || resendAttempts >= 3
                ? "text-[#52525B] cursor-default"
                : "text-[#52525B] hover:text-[#18181B] transition-colors"
                }`}
            >
              Resend Code{" "}
              <span className={`font-medium ${canResend && resendAttempts < 3 ? "text-[#6c5ce7]" : "text-[#52525B]"
                }`}>
                {resendAttempts >= 3 ? "Max Limit" : canResend ? "Now" : formatTime(timeLeft)}
              </span>
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 mt-auto lg:mt-8 w-full">


          <Button
            variant="primary"
            className="w-full py-6 text-base font-semibold"
            onClick={() => handleVerify()}
            isLoading={isSubmitting}
          >
            Verify
          </Button>

          <button
            onClick={() => setIsHelpModalOpen(true)}
            className="text-sm text-[#6c5ce7] hover:underline cursor-pointer"
          >
            Didn&apos;t get OTP Code?
          </button>
        </div>
      </div>
      <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />
    </AuthLayout >
  );
}
