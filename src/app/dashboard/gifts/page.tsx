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
import CategoryGrid from "@/components/gifting/CategoryGrid";

const CONTACTS: GiftContact[] = [
  {
    id: "u_1",
    name: "John Eze (NGN)",
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

type FlowStep = "category" | "details" | "options" | "payment";

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
  const [step, setStep] = useState<FlowStep>("category");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
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

  const handleCategorySelect = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setStep("details");
  };

  const handleNext = () => {
    if (step === "category") setStep("details");
    else if (step === "details") setStep("options");
    else if (step === "options") setStep("payment");
  };

  const handleBack = () => {
    if (step === "details") setStep("category");
    else if (step === "options") setStep("details");
    else if (step === "payment") setStep("options");
  };

  const getCurrentStepIndex = () => {
    switch (step) {
      case "category": return 0;
      case "details": return 1;
      case "options": return 2;
      case "payment": return 3;
      default: return 0;
    }
  };

  return (
    <div className="px-3 pb-3 md:px-6 md:pb-6">
      <div className="min-h-[calc(100vh-122px)] rounded-3xl bg-[#F5F5FA] border border-[#EEEEF3]">
        {}
        <div className="px-6 pt-6">
          <div className="flex items-center justify-center mb-8">
            <div className="flex items-center space-x-4">
              {[0, 1, 2, 3].map((index) => (
                <React.Fragment key={index}>
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                      index <= getCurrentStepIndex()
                        ? "bg-[#5A42DE] text-white"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {index + 1}
                  </div>
                  {index < 3 && (
                    <div
                      className={`w-12 h-1 transition-colors ${
                        index < getCurrentStepIndex()
                          ? "bg-[#5A42DE]"
                          : "bg-gray-200"
                      }`}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="flex justify-center mb-6">
            <div className="text-center">
              <h2 className="text-lg font-semibold text-[#18181B]">
                {step === "category" && "Select Category"}
                {step === "details" && "Gift Details"}
                {step === "options" && "Gift Options"}
                {step === "payment" && "Payment"}
              </h2>
              <p className="text-sm text-[#717182] mt-1">
                {step === "category" && "What is the occasion for this gift?"}
                {step === "details" && "Enter recipient and amount details"}
                {step === "options" && "Configure delivery and wrapper options"}
                {step === "payment" && "Review and complete your gift"}
              </p>
            </div>
          </div>
        </div>

        {step === "category" && (
          <div className="flex justify-center px-4 pb-10">
            <div className="w-full max-w-4xl">
              <CategoryGrid onSelect={handleCategorySelect} />
            </div>
          </div>
        )}

        {step === "details" ? (
          <SendGiftDetailsForm
            contacts={CONTACTS}
            templates={TEMPLATES}
            value={giftValues}
            onChange={setGiftValues}
            onContinue={handleNext}
            onBack={handleBack}
          />
        ) : null}

        {step === "options" ? (
          <SendGiftDetailsForm
            contacts={CONTACTS}
            templates={TEMPLATES}
            value={giftValues}
            onChange={setGiftValues}
            onContinue={handleNext}
            showOptionsOnly={true}
            onBack={handleBack}
          />
        ) : null}

        {step === "payment" ? (
          <SenderDetailsForm
            value={senderValues}
            onChange={setSenderValues}
            amountLabel={`$${amount || 0}`}
            onContinue={handleProceed}
            onBack={handleBack}
            isLoading={isProceeding}
          />
        ) : null}
      </div>

      {isSuccessModalOpen ? (
        <GiftSuccessModal
          isOpen={true}
          recipientName={giftValues.recipientName || "John Eze"}
          onClose={() => setIsSuccessModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
