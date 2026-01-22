import Link from "next/link";
import Image from "next/image";

export default function Navbar() {
    return (
        <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md">
            <div className="max-w-[1440px] mx-auto px-6 h-20 flex items-center justify-between mt-4 shadow-lg rounded-lg">
                <div className="flex items-center gap-2">
                    {/* Logo */}
                    <Link href="/" className="text-2xl font-bold flex items-center gap-2">
                        <Image src="/img/logo.svg" alt="Zendvo Logo" width={32} height={32} />
                        <span className="text-gray-900">Zendvo</span>
                    </Link>
                </div>

                <nav className="hidden md:flex items-center gap-8 font-medium text-gray-600">
                    <Link href="#" className="hover:text-gray-900 transition-colors">Community</Link>
                    <Link href="#" className="hover:text-gray-900 transition-colors">How it works</Link>
                    <Link href="#" className="hover:text-gray-900 transition-colors">Contact</Link>
                </nav>

                <button className="px-6 py-2.5 bg-[#5A42DE] text-white rounded-lg font-semibold transition-colors">
                    Join the wait list
                </button>
            </div>
        </header>
    );
}
