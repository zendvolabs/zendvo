"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/Button";
import SignupSuccessModal from "@/components/SignupSuccessModal";

export default function SignupPage() {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

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
        router.push("/dashboard");
    };

    return (
        <div className="w-full">
            <div className="text-center lg:text-left">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                    Create an account
                </h1>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    Already have an account?{" "}
                    <Link
                        href="/auth/login"
                        className="font-medium text-primary hover:text-primary-hover"
                    >
                        Sign in
                    </Link>
                </p>
            </div>

            <form className="mt-10 space-y-6" onSubmit={handleSignup}>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label
                                htmlFor="first-name"
                                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                            >
                                First name
                            </label>
                            <input
                                id="first-name"
                                name="first-name"
                                type="text"
                                required
                                className="mt-1 block w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                                placeholder="John"
                            />
                        </div>
                        <div>
                            <label
                                htmlFor="last-name"
                                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                            >
                                Last name
                            </label>
                            <input
                                id="last-name"
                                name="last-name"
                                type="text"
                                required
                                className="mt-1 block w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                                placeholder="Doe"
                            />
                        </div>
                    </div>
                    <div>
                        <label
                            htmlFor="email"
                            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                        >
                            Email address
                        </label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            required
                            className="mt-1 block w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                            placeholder="name@company.com"
                        />
                    </div>
                    <div>
                        <label
                            htmlFor="password"
                            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                        >
                            Password
                        </label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="new-password"
                            required
                            className="mt-1 block w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                            placeholder="••••••••"
                        />
                    </div>
                </div>

                <div className="flex items-start">
                    <div className="flex h-5 items-center">
                        <input
                            id="terms"
                            name="terms"
                            type="checkbox"
                            required
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                    </div>
                    <div className="ml-3 text-sm">
                        <label htmlFor="terms" className="text-gray-600 dark:text-gray-400">
                            I agree to the{" "}
                            <a href="#" className="font-medium text-primary hover:text-primary-hover">
                                Terms of Service
                            </a>{" "}
                            and{" "}
                            <a href="#" className="font-medium text-primary hover:text-primary-hover">
                                Privacy Policy
                            </a>
                            .
                        </label>
                    </div>
                </div>

                <Button className="w-full" size="lg" isLoading={isLoading}>
                    Create Account
                </Button>
            </form>

            <SignupSuccessModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                onProceed={handleProceed}
            />
        </div>
    );
}
