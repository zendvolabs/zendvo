import React from "react";
import { X } from "lucide-react";
import Button from "@/components/Button";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
      <div className="bg-white rounded-[40px] w-full max-w-sm md:max-w-xl p-8 md:p-14 relative shadow-xl animate-in fade-in zoom-in duration-200">
        <button
          onClick={onClose}
          className="absolute top-8 left-8 md:top-10 md:left-10 text-[#717182] hover:text-black transition-colors"
        >
          <X className="w-5 h-5 md:w-6 md:h-6" />
        </button>

        <div className="flex justify-center mt-8 md:mt-4 mb-8 md:mb-10">
          <div className="w-24 h-24 md:w-32 md:h-32 bg-[#E0DBFF] rounded-full flex items-center justify-center relative">
            <div className="w-20 h-20 md:w-28 md:h-28 bg-[#5E44FF] rounded-full flex items-center justify-center shadow-lg">
              <span className="text-4xl md:text-5xl">🤔</span>
            </div>
          </div>
        </div>

        <div className="text-center mb-8 md:mb-12">
          <h3 className="text-2xl md:text-3xl font-bold text-[#18181B] mb-6 md:mb-8">
            Didn&apos;t Get the Email?
          </h3>

          <ul className="text-left space-y-4 md:space-y-6 text-[13px] md:text-base leading-relaxed text-[#52525B]">
            <li className="flex gap-4 items-start">
              <span className="w-1.5 h-1.5 rounded-full bg-[#52525B] mt-1.5 md:mt-2 shrink-0" />
              <span>
                Check your spam or junk folder – Sometimes, emails get filtered.
              </span>
            </li>
            <li className="flex gap-4 items-start">
              <span className="w-1.5 h-1.5 rounded-full bg-[#52525B] mt-1.5 md:mt-2 shrink-0" />
              <span>Wait a few minutes – It may take a moment to arrive.</span>
            </li>
            <li className="flex gap-4 items-start">
              <span className="w-1.5 h-1.5 rounded-full bg-[#52525B] mt-1.5 md:mt-2 shrink-0" />
              <span>Resend the email – Tap the button to send it again.</span>
            </li>
            <li className="flex gap-4 items-start">
              <span className="w-1.5 h-1.5 rounded-full bg-[#52525B] mt-1.5 md:mt-2 shrink-0" />
              <span>
                Check if your email is correct – Sometimes, we make mistakes.
              </span>
            </li>
          </ul>
        </div>

        <div className="mt-8 md:mt-10">
          <Button
            variant="primary"
            className="w-full py-6 md:py-7 text-base md:text-lg font-semibold rounded-2xl bg-[#5E44FF] hover:bg-[#4D35FF]"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
