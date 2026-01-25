"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, ChevronDown } from "lucide-react";
import Button from "@/components/Button";
import SignupSuccessModal from "@/components/SignupSuccessModal";

export default function SignupPage() {
    const [isOpen, setIsOpen] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handleSignup = (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        // Simulate API call
        setTimeout(() => {
            setIsLoading(false);
            setIsOpen(true);
        }, 1500);
    };

    const handleProceed = () => {
        setIsOpen(false);
        // In a real app, you might redirect to a dashboard or onboarding
        console.log("Proceeding to dashboard...");
    };

    return (
        <div className="w-full">
            <div className="mb-8">
                <h1 className="text-[32px] font-bold tracking-tight text-[#17171C]">
                    Create an account
                </h1>
                <p className="mt-1 text-sm font-medium text-[#17171C]">
                    To start receiving cash gifts
                </p>
            </div>

            <form className="space-y-6" onSubmit={handleSignup}>
                <div className="space-y-5">
                    {/* Full Name */}
                    <div className="space-y-1.5">
                        <label
                            htmlFor="full-name"
                            className="block text-xs font-medium text-gray-400"
                        >
                            Full Name
                        </label>
                        <input
                            id="full-name"
                            name="full-name"
                            type="text"
                            required
                            className="block w-full rounded-xl border border-gray-100 bg-white px-4 py-3.5 text-sm text-[#17171C] ring-1 ring-gray-100 transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none placeholder:text-gray-300"
                            placeholder="John Eze"
                        />
                    </div>

                    {/* Phone Number */}
                    <div className="space-y-1.5">
                        <label
                            htmlFor="phone"
                            className="block text-xs font-medium text-gray-400"
                        >
                            Phone Number
                        </label>
                        <div className="flex gap-2">
                            <div className="flex shrink-0 items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-3.5 ring-1 ring-gray-100">
                                <span className="text-xl">🇳🇬</span>
                                <span className="text-sm font-medium text-[#17171C]">+234</span>
                                <ChevronDown className="size-4 text-gray-400" />
                            </div>
                            <input
                                id="phone"
                                name="phone"
                                type="tel"
                                required
                                className="block w-full flex-1 rounded-xl border border-gray-100 bg-white px-4 py-3.5 text-sm text-[#17171C] ring-1 ring-gray-100 transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none placeholder:text-gray-300"
                                placeholder="81 123 456 78"
                            />
                        </div>
                    </div>

                    {/* Email Address */}
                    <div className="space-y-1.5">
                        <label
                            htmlFor="email"
                            className="block text-xs font-medium text-gray-400"
                        >
                            Email address
                        </label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            required
                            className="block w-full rounded-xl border border-gray-100 bg-white px-4 py-3.5 text-sm text-[#17171C] ring-1 ring-gray-100 transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none placeholder:text-gray-300"
                            placeholder="john123@gmail.com"
                        />
                    </div>

                    {/* Password */}
                    <div className="space-y-1.5">
                        <label
                            htmlFor="password"
                            className="block text-xs font-medium text-gray-400"
                        >
                            Password
                        </label>
                        <div className="relative">
                            <input
                                id="password"
                                name="password"
                                type={showPassword ? "text" : "password"}
                                required
                                className="block w-full rounded-xl border border-gray-100 bg-white px-4 py-3.5 pr-12 text-sm text-[#17171C] ring-1 ring-gray-100 transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none placeholder:text-gray-300"
                                placeholder="••••••••••••••••"
                            />
                            <button
                                type="button"
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                onClick={() => setShowPassword(!showPassword)}
                            >
                                {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                            </button>
                        </div>
                        <p className="text-[10px] leading-relaxed text-gray-400">
                            Password must be at least 8 characters long and include an uppercase letter, a lowercase letter, a number, and a special character.
                        </p>
                    </div>

                    {/* Confirm Password */}
                    <div className="space-y-1.5">
                        <label
                            htmlFor="confirm-password"
                            className="block text-xs font-medium text-gray-400"
                        >
                            Confirm Password
                        </label>
                        <div className="relative">
                            <input
                                id="confirm-password"
                                name="confirm-password"
                                type={showConfirmPassword ? "text" : "password"}
                                required
                                className="block w-full rounded-xl border border-gray-100 bg-white px-4 py-3.5 pr-12 text-sm text-[#17171C] ring-1 ring-gray-100 transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none placeholder:text-gray-300"
                                placeholder="••••••••••••••••"
                            />
                            <button
                                type="button"
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            >
                                {showConfirmPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                            </button>
                        </div>
                    </div>
                </div>

                <Button className="w-full bg-primary text-white py-4 h-auto text-base font-bold rounded-xl" isLoading={isLoading}>
                    Create Account
                </Button>
            </form>

            <p className="mt-8 text-center text-sm font-bold text-[#17171C]">
                Already have an account?{" "}
                <Link
                    href="/auth/login"
                    className="text-primary hover:underline transition-all"
                >
                    Log in
                </Link>
            </p>

            <SignupSuccessModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                onProceed={handleProceed}
            />
        </div>
    );
}
