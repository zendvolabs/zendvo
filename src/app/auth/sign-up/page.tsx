'use client'
import React, { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@/layouts/AuthLayout';
import { WorldMapShowcase } from '@/components/auth/WordMapShowcase';
import { Input } from '@/components/Input';
import { PhoneInput } from '@/components/PhoneInput';
import { PasswordInput } from '@/components/PasswordInput';
import Button from '@/components/Button';

interface FormData {
  fullName: string;
  phoneNumber: string;
  countryCode: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  fullName?: string;
  phoneNumber?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

 const SignUp: React.FC = () => {
  const route = useRouter();
  const [formData, setFormData] = useState<FormData>({
    fullName: '',
    phoneNumber: '',
    countryCode: '+234',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string): string | undefined => {
    if (password.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    if (!/[A-Z]/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/[a-z]/.test(password)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/[0-9]/.test(password)) {
      return 'Password must contain at least one number';
    }
    return undefined;
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Full Name validation
    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    } else if (formData.fullName.trim().length < 2) {
      newErrors.fullName = 'Full name must be at least 2 characters';
    }

    // Phone Number validation
    if (!formData.phoneNumber.trim()) {
      newErrors.phoneNumber = 'Phone number is required';
    } else if (!/^\d{9,15}$/.test(formData.phoneNumber.replace(/\s/g, ''))) {
      newErrors.phoneNumber = 'Please enter a valid phone number';
    }

    // Email validation
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    // Password validation
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else {
      const passwordError = validatePassword(formData.password);
      if (passwordError) {
        newErrors.password = passwordError;
      }
    }

    // Confirm Password validation
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    // Simulate API call
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // In a real application, you would make an API call here
      console.log('Form submitted:', formData);
      
      // Navigate to success page or dashboard
      route.push('/dashboard');
    } catch (error) {
      console.error('Sign up error:', error);
      setErrors({ email: 'An error occurred. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
    // Clear error for this field when user starts typing
    if (errors[field as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <AuthLayout showcaseContent={<WorldMapShowcase />}>
      <div className='space-y-10'>
       <div className='gap-1 flex flex-col'>
         <h1 className="text-xl md:text-[2rem] leading-5 md:leading-10 tracking-[-0%] font-bold text-[#18181B] ">
          Create an account
        </h1>
        <p className="text-xs text-[#18181B] leading-[100%] tracking-[0%] ">
          To start receiving cash gifts
        </p>
       </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            id="fullName"
            label="Full Name"
            type="text"
            placeholder="John Eze"
            value={formData.fullName}
            onChange={handleChange('fullName')}
            error={errors.fullName}
            autoFocus
            autoComplete="name"
          />

          <PhoneInput
            id="phoneNumber"
            label="Phone Number"
            placeholder="81 123 456 78"
            value={formData.phoneNumber}
            onChange={handleChange('phoneNumber')}
            error={errors.phoneNumber}
            countryCode={formData.countryCode}
            onCountryCodeChange={(code) => setFormData(prev => ({ ...prev, countryCode: code }))}
            autoComplete="tel"
          />

          <Input
            id="email"
            label="Email address"
            type="email"
            placeholder="john123@gmail.com"
            value={formData.email}
            onChange={handleChange('email')}
            error={errors.email}
            autoComplete="email"
          />

          <PasswordInput
            id="password"
            label="Password"
            placeholder="••••••••••••••"
            value={formData.password}
            onChange={handleChange('password')}
            error={errors.password}
            helperText="Password must be at least 8 characters and include uppercase, lowercase, and numbers"
            autoComplete="new-password"
          />

          <PasswordInput
            id="confirmPassword"
            label="Confirm Password"
            placeholder="••••••••••••••"
            value={formData.confirmPassword}
            onChange={handleChange('confirmPassword')}
            error={errors.confirmPassword}
            autoComplete="new-password"
          />

          <div className="pt-2">
            <Button type="submit" variant='primary' className='w-full bg-[#5A42DE]! rounded-lg! text-base! font-medium! cursor-pointer ' isLoading={isLoading}>
Create Account            </Button>
          </div>

          <p className="text-center text-[14px] text-[#717182] pt-2">
            Already have an account?{' '}
            <Link 
              href="/login" 
              className="text-[#6c5ce7] hover:text-[#5f51d8] font-medium transition-colors"
            >
              Log in
            </Link>
          </p>
        </form>
      </div>
    </AuthLayout>
  );
};
export default SignUp