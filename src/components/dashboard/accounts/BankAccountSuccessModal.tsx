"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check } from "lucide-react";
import Button from "@/components/Button";

interface BankAccountSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddAnother: () => void;
}

const BankAccountSuccessModal: React.FC<BankAccountSuccessModalProps> = ({
  isOpen,
  onClose,
  onAddAnother,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    setTimeout(() => closeButtonRef.current?.focus(), 50);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative w-full max-w-[400px] bg-white rounded-3xl shadow-2xl p-8 focus:outline-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bank-success-title"
            tabIndex={-1}
          >
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="absolute top-5 left-5 p-1.5 text-[#18181B] hover:text-[#52525B] hover:bg-gray-100 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#5A45FE]"
              aria-label="Close modal"
            >
              <X size={20} />
            </button>

            {/* Success icon */}
            <div className="flex justify-center mt-8 mb-8">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                className="relative w-[100px] h-[100px] bg-[#e4faf0] rounded-full flex items-center justify-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
                  className="w-[64px] h-[64px] bg-[#00CA71] rounded-full flex items-center justify-center"
                >
                  <Check size={32} className="text-white" strokeWidth={2.5} />
                </motion.div>

                {/* Decorative dots */}
                <svg
                  className="absolute w-[180%] h-[180%] -m-[40%] text-[#00CA71] pointer-events-none"
                  viewBox="0 0 100 100"
                  fill="currentColor"
                >
                  <circle cx="50" cy="16" r="1.5" className="opacity-70" />
                  <circle cx="62" cy="19" r="2" className="opacity-50" />
                  <circle cx="80" cy="36" r="1.5" className="opacity-60" />
                  <circle cx="84" cy="50" r="2" className="opacity-70" />
                  <circle cx="78" cy="68" r="1.5" className="opacity-50" />
                  <circle cx="62" cy="82" r="2" className="opacity-60" />
                  <circle cx="50" cy="86" r="1.5" className="opacity-70" />
                  <circle cx="38" cy="82" r="2" className="opacity-50" />
                  <circle cx="22" cy="68" r="1.5" className="opacity-60" />
                  <circle cx="16" cy="50" r="2" className="opacity-70" />
                  <circle cx="22" cy="32" r="1.5" className="opacity-50" />
                  <circle cx="38" cy="19" r="2" className="opacity-60" />
                </svg>
              </motion.div>
            </div>

            {/* Text */}
            <div className="text-center mb-8">
              <h2
                id="bank-success-title"
                className="text-[22px] font-bold text-[#18181B] mb-3 leading-tight"
              >
                Bank account added successfully
              </h2>
              <p className="text-[14px] text-[#52525B] leading-relaxed">
                Your bank account has been linked and is ready for withdrawals.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <Button
                variant="primary"
                className="w-full h-12 rounded-xl text-[15px] font-semibold bg-[#5A45FE] hover:bg-[#4b35e5] transition-colors"
                onClick={onClose}
              >
                Done
              </Button>
              <Button
                variant="outline"
                className="w-full h-12 rounded-xl text-[15px] font-semibold border border-[#E5E7EB] text-[#18181B] hover:bg-gray-50 transition-colors"
                onClick={onAddAnother}
              >
                Add another account
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default BankAccountSuccessModal;
