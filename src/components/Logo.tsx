"use client";

import Link from "next/link";
import Image from "next/image";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const Logo = ({ className }: { className?: string }) => {
    return (
        <Link href="/" className={cn("block", className)}>
            <Image
                src="/img/logo.svg"
                alt="Zendvo Logo"
                width={120}
                height={40}
                priority
                className="h-auto w-auto"
            />
        </Link>
    );
};

export default Logo;
