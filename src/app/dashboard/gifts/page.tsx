"use client";

import React, { useMemo, useState } from "react";
import SendGiftDetailsForm, {
  GiftContact,
  GiftDetailsFormValues,
  GiftTemplate,
} from "@/components/gift/SendGiftDetailsForm";
import SenderDetailsForm, {
  SenderDetailsValues,
} from "@/components/gift/SenderDetailsForm";
import ReviewGiftDetails from "@/components/gift/ReviewGiftDetails";
import GiftSuccessModal from "@/components/gift/GiftSuccessModal";

const CONTACTS: GiftContact[] = [
  {
    id: "u_1",
    name: "Johns Eze (NGN)",
    email: "john.eze@gmail.com",
    phone: "8112345678",
  },
  {
    id: "u_2",
    name: "Amaka Nwosu (NGN)",
    email: "amaka@gmail.com",
    phone: "8029991111",
  },
];

const TEMPLATES: GiftTemplate[] = [
  { id: "tpl_minimal", name: "Minimal Wish" },
  { id: "tpl_party", name: "Party Sparks" },
];

const INITIAL_GIFT_VALUES: GiftDetailsFormValues = {
  recipientId: "",
  recipientName: "",
  recipientEmail: "",
  recipientPhone: "",
  amount: "",
  currency: "USD",
  message: "I dey feel your hustle",
  templateId: "",
  hideAmountUntilUnlock: true,
  anonymousUntilUnlock: false,
  unlockDate: "",
  unlockTime: "",
};

const INITIAL_SENDER_VALUES: SenderDetailsValues = {
  fullName: "Somtochukwu Eze",
  email: "somtochukwu@gmail.com",
  confirmEmail: "somtochukwu@gmail.com",
  imageName: "",
};

type FlowStep = "send-gift" | "sender-details" | "review";

const formatUnlockLabel = (date: string, time: string): string => {
  if (!date && !time) return "-";
  const dateLabel = date || "date not set";
  const timeLabel = time || "time not set";
  return `${dateLabel} ${timeLabel}`;
};

export default function DashboardGiftsPage() {
  const [giftValues, setGiftValues] =
    useState<GiftDetailsFormValues>(INITIAL_GIFT_VALUES);
  const [senderValues, setSenderValues] = useState<SenderDetailsValues>(
    INITIAL_SENDER_VALUES,
  );
  const [step, setStep] = useState<FlowStep>("send-gift");
  const [isProceeding, setIsProceeding] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);

  const amount = Number(giftValues.amount || 0);
  const processingFee = useMemo(() => {
    if (amount <= 0) return 0;
    return Math.round(amount * 0.02);
  }, [amount]);

  const handleProceed = async () => {
    setIsProceeding(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    setIsProceeding(false);
    setIsSuccessModalOpen(true);
  };

  return (
    <div className="px-3 pb-3 md:px-6 md:pb-6">
      <div className="min-h-[calc(100vh-122px)] rounded-3xl bg-[#F5F5FA] border border-[#EEEEF3]">
        {step === "send-gift" ? (
          <SendGiftDetailsForm
            contacts={CONTACTS}
            templates={TEMPLATES}
            value={giftValues}
            onChange={setGiftValues}
            onContinue={() => setStep("sender-details")}
          />
        ) : null}

        {step === "sender-details" ? (
          <SenderDetailsForm
            value={senderValues}
            onChange={setSenderValues}
            amountLabel={`$${amount || 0}`}
            onContinue={() => setStep("review")}
          />
        ) : null}

        {step === "review" ? (
          <ReviewGiftDetails
            recipientName={giftValues.recipientName || "John Eze (NGN)"}
            recipientPhone={giftValues.recipientPhone || "8112345678"}
            amount={amount}
            processingFee={processingFee}
            hideAmountUntilUnlock={giftValues.hideAmountUntilUnlock}
            anonymousUntilUnlock={giftValues.anonymousUntilUnlock}
            unlockLabel={formatUnlockLabel(
              giftValues.unlockDate,
              giftValues.unlockTime,
            )}
            message={giftValues.message}
            onProceed={handleProceed}
            isLoading={isProceeding}
          />
        ) : null}
      </div>

      {isSuccessModalOpen ? (
        <GiftSuccessModal
          recipientName={giftValues.recipientName || "John Eze"}
          onClose={() => setIsSuccessModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
