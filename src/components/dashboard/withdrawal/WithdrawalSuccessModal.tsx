"use client";

import React, { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Button from "@/components/Button";
import { useFocusTrap } from "@/hooks/useFocusTrap";

type WithdrawalSuccessModalProps = {
  isOpen: boolean;
  amount: number;
  currency?: string;
  onClose: () => void;
};

const formatWithdrawalAmount = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const WithdrawalSuccessModal: React.FC<WithdrawalSuccessModalProps> = ({
  isOpen,
  amount,
  currency = "USD",
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, isOpen);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  const formattedAmount = formatWithdrawalAmount(amount, currency);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            ref={modalRef}
            className="w-full max-w-[420px] rounded-3xl bg-white px-6 py-8 text-center shadow-2xl focus:outline-none sm:px-8 sm:py-10"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdrawal-success-title"
            aria-describedby="withdrawal-success-description"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-8 flex size-[100px] items-center justify-center rounded-full bg-[#E4FAF0]">
              <div className="flex size-16 items-center justify-center rounded-full bg-[#00CA71]">
                <Check className="text-white" size={34} strokeWidth={2.75} />
              </div>
            </div>

            <div className="mx-auto mb-8 max-w-[320px]">
              <h2
                id="withdrawal-success-title"
                className="text-[24px] font-semibold leading-tight text-[#18181B] sm:text-[28px]"
              >
                Withdrawal successful!
              </h2>
              <p
                id="withdrawal-success-description"
                className="mt-3 text-[15px] leading-6 text-[#717182] sm:text-base"
              >
                Your withdrawal of {formattedAmount} was successful
              </p>
            </div>

            <Button
              type="button"
              onClick={onClose}
              className="h-14 w-full rounded-xl bg-[#5A42DE] text-base font-semibold text-white hover:bg-[#4E37CC]"
            >
              Done
            </Button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

export default WithdrawalSuccessModal;
