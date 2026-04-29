import React, { forwardRef, InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  icon?: React.ReactNode;
  suffix?: React.ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, icon, suffix, className = "", containerClassName = "", ...props }, ref) => {
    return (
      <div className={`w-full relative ${containerClassName}`}>
        {label && (
          <label
            htmlFor={props.id}
            className="block absolute -top-2.5 left-4 px-1 bg-white z-10 text-[11px] text-[#9CA3AF] pointer-events-none"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {icon && (
            <div className="absolute left-4 text-[#9CA3AF] pointer-events-none">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={`
              w-full rounded-lg
              bg-white border border-[#E5E7EB]
              text-[#030213] placeholder:text-[#d1d1d8] text-sm
              transition-all duration-200
              focus:outline-none focus:ring-1 focus:ring-[#5A45FE] focus:border-[#5A45FE]
              disabled:opacity-50 disabled:cursor-not-allowed
              ${icon ? "pl-11" : "pl-4"}
              ${suffix ? "pr-11" : "pr-4"}
              ${label ? "py-3.5" : "py-3.5"}
              ${error ? "border-red-500 focus:ring-red-500/20 focus:border-red-500" : ""}
              ${className}
            `}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={
              error
                ? `${props.id}-error`
                : helperText
                  ? `${props.id}-helper`
                  : undefined
            }
            {...props}
          />
          {suffix && (
            <div className="absolute right-4 text-[#9CA3AF]">
              {suffix}
            </div>
          )}
        </div>
        {error && (
          <p
            id={`${props.id}-error`}
            className="mt-1.5 text-[13px] text-red-500 font-medium"
            role="alert"
          >
            {error}
          </p>
        )}
        {helperText && !error && (
          <p
            id={`${props.id}-helper`}
            className="mt-1.5 text-[11px] text-[#717182] leading-relaxed"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
