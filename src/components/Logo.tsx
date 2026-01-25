"use client";

import Link from "next/link";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const Logo = ({ className }: { className?: string }) => {
    return (
        <Link href="/" className={cn("flex items-center gap-2 group", className)}>
            <img src="/img/logo.svg" alt="Zendvo Logo" loading="lazy" />
        </Link>
    );
};

export default Logo;
