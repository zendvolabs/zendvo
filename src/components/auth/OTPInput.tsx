"use client";

import React, { useRef, useState, ClipboardEvent, KeyboardEvent, ChangeEvent, useEffect } from "react";

interface OTPInputProps {
  length?: number;
  onComplete?: (otp: string) => void;
  onChange?: (otp: string) => void;
  error?: boolean;
}

const OTPInput: React.FC<OTPInputProps> = ({
  length = 6,
  onComplete,
  onChange,
  error = false,
}) => {
  const [otp, setOtp] = useState<string[]>(new Array(length).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  const handleChange = (e: ChangeEvent<HTMLInputElement>, index: number) => {
    const value = e.target.value;
    if (isNaN(Number(value))) return;

    const newOtp = [...otp];
    // Allow only the last entered character
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    const otpString = newOtp.join("");
    if (onChange) onChange(otpString);

    // Call onComplete when all digits are filled
    if (otpString.length === length && !newOtp.includes("")) {
      if (onComplete) onComplete(otpString);
    }

    // Move to next input if value is entered
    if (value && index < length - 1 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleClick = (index: number) => {
    inputRefs.current[index]?.setSelectionRange(1, 1);
    
    // Optional: validation to prevent skipping inputs
    if (index > 0 && !otp[index - 1]) {
      inputRefs.current[otp.indexOf("")]?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && !otp[index] && index > 0 && inputRefs.current[index - 1]) {
      // Move to previous input on backspace if current is empty
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text/plain").slice(0, length);
    
    if (!/^\d+$/.test(pastedData)) return; // Only allow numbers

    const newOtp = [...otp];
    pastedData.split("").forEach((char, i) => {
      newOtp[i] = char;
    });
    setOtp(newOtp);
    
    const otpString = newOtp.join("");
    if (onChange) onChange(otpString);
    if (otpString.length === length && onComplete) onComplete(otpString);

    // Focus existing or last filled index
    const focusIndex = Math.min(pastedData.length, length - 1);
    inputRefs.current[focusIndex]?.focus();
  };

  return (
    <div className="flex gap-3 justify-between max-w-xs mx-auto md:mx-0 md:max-w-md">
      {otp.map((digit, index) => (
        <input
          key={index}
          type="text"
          inputMode="numeric"
          maxLength={1}
          ref={(ref) => {
              inputRefs.current[index] = ref;
          }}
          value={digit}
          onChange={(e) => handleChange(e, index)}
          onClick={() => handleClick(index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onPaste={handlePaste}
          className={`
            w-12 h-12 md:w-14 md:h-14 
            border rounded-[14px] 
            text-center text-lg font-semibold
            focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]/20
            transition-all duration-200
            ${error 
              ? "border-red-500 text-red-500 focus:border-red-500" 
              : "border-[#E5E7EB] text-[#18181B] focus:border-[#6c5ce7]"
            }
          `}
        />
      ))}
    </div>
  );
};

export default OTPInput;
