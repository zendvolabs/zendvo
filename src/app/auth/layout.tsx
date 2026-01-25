"use client";

import React from "react";
import Image from "next/image";
import Logo from "@/components/Logo";

export default function AuthLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="flex min-h-screen w-full">
            <div className="flex w-full overflow-hidden bg-white lg:flex-row">
                {/* Left side: Content */}
                <div className="relative z-10 flex flex-1 flex-col overflow-y-auto px-6 py-10 md:px-12 lg:px-16 lg:py-12">
                    <main className="mx-auto w-full max-w-[440px] flex-1">
                        <div className="mb-4">
                            <Logo />
                        </div>
                        <div className="animate-fade-in">
                            {children}
                        </div>
                    </main>
                    <footer className="mt-12 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-medium text-gray-400">
                        <a href="#" className="hover:text-primary transition-colors">Help</a>
                        <span className="text-gray-300">|</span>
                        <a href="#" className="hover:text-primary transition-colors">Terms & Conditions</a>
                        <span className="text-gray-300">|</span>
                        <a href="#" className="hover:text-primary transition-colors">Privacy Policy</a>
                    </footer>
                </div>

                {/* Right side: Feature Showcase (Desktop only) */}
                <div className="relative hidden flex-1 lg:block bg-[#F4F4F9]">
                    <Image
                        src="/img/auth-bg.png"
                        alt="Feature Showcase"
                        fill
                        className="object-contain"
                        priority
                    />
                </div>
            </div>
        </div>
    );
}
