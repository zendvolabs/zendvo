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
          <h1 className="text-3xl md:text-4xl font-bold text-[#18181B] mb-4">
            Verify your email address
          </h1>
          <p className="text-[#52525B] text-base md:text-lg mb-10 leading-relaxed">
            Please enter the verification code sent to your email account{" "}
            <span className="font-medium text-[#18181B]">jo***3@gmail.com</span>
          </p>

          <div className="mb-10">
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
              className={`text-base font-semibold transition-colors flex items-center gap-2 ${
                !canResend || resendAttempts >= 3
                  ? "text-[#717182] cursor-default"
                  : "text-[#5E44FF] hover:text-[#4D35FF]"
              }`}
            >
              Resend Code{" "}
              <span
                className={`font-bold ${
                  canResend && resendAttempts < 3
                    ? "text-[#5E44FF]"
                    : "text-[#717182]"
                }`}
              >
                {resendAttempts >= 3
                  ? "(Max Limit)"
                  : canResend
                    ? "Now"
                    : formatTime(timeLeft)}
              </span>
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-6 mt-auto lg:mt-12 w-full">
          <Button
            variant="primary"
            className="w-full py-7 text-lg font-bold bg-[#5E44FF] hover:bg-[#4D35FF] shadow-lg shadow-purple-200"
            onClick={() => handleVerify()}
            isLoading={isSubmitting}
          >
            Create Account
          </Button>

          <button
            onClick={() => setIsHelpModalOpen(true)}
            className="text-base font-semibold text-[#5E44FF] hover:underline cursor-pointer"
          >
            Didn&apos;t get OTP Code?
          </button>
        </div>
      </div>
      <HelpModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
      />
    </AuthLayout>
  );
}
