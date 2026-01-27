"use client";

import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading = false, children, ...props }, ref) => {
    const variants = {
      primary: "bg-[#6c5ce7] text-white hover:bg-[#5b4bc4] disabled:bg-[#6c5ce7]/70",
      secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
      outline: "border border-gray-300 bg-transparent hover:bg-gray-50 text-gray-700",
      ghost: "bg-transparent hover:bg-gray-100 text-gray-700",
    };

    const sizes = {
      sm: "h-9 px-3 text-sm",
      md: "h-11 px-6 text-base",
      lg: "h-12 px-8 text-lg",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center font-medium justify-center rounded-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
          variants[variant],
          sizes[size],
          className
        )}
        disabled={isLoading || props.disabled}
        {...props}
      >
        {isLoading ? (
          <svg className="mr-2 h-4 w-4 animate-spin text-current" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
