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
        <div className="flex min-h-screen w-full flex-col lg:flex-row">
            {/* Left side: Content */}
            <div className="flex flex-1 flex-col p-6 md:p-12 lg:p-16">
                <header className="mb-12">
                    <Logo />
                </header>
                <main className="flex flex-1 items-center justify-center">
                    <div className="w-full max-w-[440px] space-y-8 animate-fade-in">
                        {children}
                    </div>
                </main>
                <footer className="mt-auto pt-12 text-center text-sm text-gray-400 lg:text-left">
                    &copy; {new Date().getFullYear()} Zendvo. All rights reserved.
                </footer>
            </div>

            {/* Right side: Feature Showcase (Desktop only) */}
            <div className="relative hidden flex-1 lg:block">
                <img src="/img/auth-bg.png" className="w-full h-full object-cover" />
            </div>
        </div>
    );
}
