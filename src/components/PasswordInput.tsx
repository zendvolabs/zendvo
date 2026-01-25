import React, { forwardRef, InputHTMLAttributes, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ label, error, helperText, className = '', ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);

    return (
      <div className="w-full relative">
        {label && (
          <label 
            htmlFor={props.id} 
            className="block absolute -top-2.75 z-20 left-4 px-2 bg-white  text-xs  text-[#9CA3AF] py-0.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            type={showPassword ? 'text' : 'password'}
            className={`
              w-full px-4 py-3 pr-12 rounded-lg
              bg-white border border-[#E5E7EB]
              text-[#030213] placeholder:text-[#717182]
              transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]/20 focus:border-[#6c5ce7]
              disabled:opacity-50 disabled:cursor-not-allowed
              ${error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : ''}
              ${className}
            `}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${props.id}-error` : helperText ? `${props.id}-helper` : undefined}
            {...props}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#717182] hover:text-[#030213] transition-colors p-1"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="w-5 h-5" />
            ) : (
              <Eye className="w-5 h-5" />
            )}
          </button>
        </div>
        {error && (
          <p 
            id={`${props.id}-error`}
            className="mt-1.5 text-[13px] text-red-500"
            role="alert"
          >
            {error}
          </p>
        )}
        {helperText && !error && (
          <p 
            id={`${props.id}-helper`}
            className="mt-1.5 text-[11px]  text-[#717182] leading-relaxed"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';
