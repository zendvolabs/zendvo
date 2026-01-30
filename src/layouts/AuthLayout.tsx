import React, { ReactNode } from "react";
import { Check } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

import LogoImage from "../../public/logo.png";

interface AuthLayoutProps {
  children: ReactNode;
  showcaseContent?: ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({
  children,
  showcaseContent,
}) => {
  return (
    <div className="min-h-screen flex flex-col   lg:flex-row">
      <div className="w-full lg:w-1/2 flex flex-col relative bg-white min-h-screen lg:min-h-0">
        <div className="w-full pt-8 pl-5 md:pl-40 lg:pl-20 xl:pl-38 lg:pt-18 xl:pt-20">
          <Link href="/" className="inline-flex items-center gap-2">
            <Image
              src={LogoImage.src}
              width={LogoImage.width}
              height={LogoImage.height}
              blurDataURL={LogoImage.blurDataURL}
              alt="Zendvo company logo"
              className="max-h-8 w-auto"
            />
          </Link>
        </div>

        <div className="flex-1 flex flex-col lg:items-center justify-center px-6 lg:px-16 pb-12">
          <div className="w-full max-w-110 flex-1 flex flex-col justify-center">
            {children}
          </div>
        </div>

        <div className="w-full pb-6 lg:pb-0 lg:absolute lg:bottom-6 lg:left-1/2 lg:-translate-1/2">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] text-[#717182]">
            <Link
              href="/help"
              className="hover:text-[#030213] transition-colors"
            >
              Help
            </Link>
            <span className="text-[#e0e0e0]">|</span>
            <Link
              href="/terms"
              className="hover:text-[#030213] transition-colors"
            >
              Terms & Conditions
            </Link>
            <span className="text-[#e0e0e0]">|</span>
            <Link
              href="/privacy"
              className="hover:text-[#030213] transition-colors"
            >
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>

      {showcaseContent && (
        <div className="hidden lg:flex w-1/2  bg-[#F7F7F8] items-center justify-center ">
          <div className="w-full ">{showcaseContent}</div>
        </div>
      )}
    </div>
  );
};
