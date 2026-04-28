import { NotificationIcon } from "@/assets/svg";
import { ArrowLeft } from "lucide-react";
import UserProfile from "@/assets/images/user.png";
import MobileLogo from "../../../assets/images/zendo-logo.png";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";

interface NavBarProps {
  onMenuToggle: () => void;
}

export const NavBar = ({ onMenuToggle }: NavBarProps) => {
  const pathname = usePathname();
  const router = useRouter();

  const titleByRoute: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/dashboard/sender": "Sender",
    "/dashboard/recipient": "Recipient",
    "/dashboard/gifts": "Send Gift",
    "/dashboard/wallet": "Wallet",
    "/settings": "Settings",
  };

  const pageTitle = titleByRoute[pathname] || "Dashboard";
  const canGoBack = pathname !== "/dashboard";

  return (
    <header className="bg-white w-full sticky top-0 left-0 z-10 ">
      <nav className="py-4.5 px-5  lg:pl-0 pr-6 flex items-center justify-between ">
        <div className="md:hidden">
          <Image
            src={MobileLogo.src}
            alt="Zendvo Logo"
            width={MobileLogo.width}
            height={MobileLogo.height}
            blurDataURL={MobileLogo.blurDataURL}
            className="object-contain h-8 w-auto md:hidden"
          />
        </div>
        <button
          onClick={() => {
            if (canGoBack) {
              router.back();
            } else {
              router.push("/dashboard");
            }
          }}
          className="md:flex items-center gap-3  text-[#71717A] cursor-pointer hover:bg-gray-50 rounded-xl transition-colors hidden"
        >
          <div className="bg-[#F7F7F8] size-8 rounded-full flex items-center justify-center ">
            <ArrowLeft size={16} />
          </div>
          <span>{pageTitle}</span>
        </button>

        <p className="text-[#71717A] md:hidden">{pageTitle}</p>

        <div className="lg:flex items-center justify-center  gap-4.5 hidden">
          <div className="size-8 bg-[#F7F7F8] rounded-full flex items-center justify-center">
            <NotificationIcon />
          </div>
          <div className="size-8 bg-[#F7F7F8] rounded-full">
            <Image
              src={UserProfile}
              alt="User Profile"
              width={32}
              height={32}
              className="rounded-full object-cover"
            />
          </div>
        </div>

        {}
        <button
          onClick={onMenuToggle}
          className="flex items-center gap-1 p-2 text-[#71717A] cursor-pointer hover:bg-gray-50 rounded-xl transition-colors lg:hidden flex-col"
        >
          <div className="w-5 h-0.5 bg-gray-400 rounded-full"></div>
          <div className="w-5 h-0.5 bg-gray-400 rounded-full"></div>
          <div className="w-5 h-0.5 bg-gray-400 rounded-full"></div>
        </button>
      </nav>
    </header>
  );
};
