import React, { forwardRef, InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', ...props }, ref) => {
    return (
      <div className="w-full relative ">
        {label && (
          <label 
            htmlFor={props.id} 
            className="block absolute -top-2.75 left-4 px-2 bg-white  text-xs  text-[#9CA3AF] py-0.5"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`
            w-full px-4 py-3 rounded-lg
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
            className="mt-1.5 text-[11px] text-[#717182] leading-relaxed"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
