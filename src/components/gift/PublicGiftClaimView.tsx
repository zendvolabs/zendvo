"use client";

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Gift, LoaderCircle, Sparkles } from "lucide-react";
import Button from "@/components/Button";
import { launchCelebrationConfetti } from "@/lib/confetti";
import { GiftRevealStage } from "./GiftRevealStage";
import { ScratchReveal } from "./ScratchReveal";
import { playMysterySound, triggerHaptic } from "@/lib/mystery-ux";

type GiftSummary = {
  recipient: {
    id?: string;
    name?: string;
    email?: string;
  };
  amount: number;
  currency: string;
  processingFee: number;
  totalAmount: number;
  privacySettings: {
    hideAmount: boolean;
    hideSender: boolean;
  };
  unlockDatetime: string | null;
  message: string | null;
  senderName: string | null;
};

type ClaimResponse = {
  message?: string;
  shareLink?: string;
  status?: string;
};

interface PublicGiftClaimViewProps {
  giftId: string;
}

const currencyFormatter = (currency: string, amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);

const formatUnlockLabel = (value: string | null) => {
  if (!value) {
    return "Available now";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Available soon";
  }

  return parsedDate.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

export default function PublicGiftClaimView({
  giftId,
}: PublicGiftClaimViewProps) {
  const [gift, setGift] = useState<GiftSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasFiredConfettiRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const loadGiftSummary = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`/api/gifts/public/${giftId}/summary`, {
          cache: "no-store",
        });
        const payload = await response.json();

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load gift details.");
        }

        if (isMounted) {
          setGift(payload.data as GiftSummary);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load gift details.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadGiftSummary();

    return () => {
      isMounted = false;
    };
  }, [giftId]);

  useEffect(() => {
    if (!claimResult || hasFiredConfettiRef.current) {
      return;
    }

    hasFiredConfettiRef.current = true;
    return launchCelebrationConfetti();
  }, [claimResult]);

  const handleClaimGift = async () => {
    try {
      setIsClaiming(true);
      setError(null);

      const response = await fetch(`/api/gifts/public/${giftId}/confirm`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to claim gift right now.");
      }

      setClaimResult(payload as ClaimResponse);
      triggerHaptic("heavy");
    } catch (claimError) {
      setError(
        claimError instanceof Error
          ? claimError.message
          : "Unable to claim gift right now.",
      );
    } finally {
      setIsClaiming(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#eef3ff,_#f8fafc_55%,_#ffffff_100%)] px-4 py-12">
        <div className="mx-auto flex max-w-xl items-center justify-center rounded-[32px] border border-white/70 bg-white/85 p-12 shadow-[0_30px_80px_rgba(95,82,255,0.12)] backdrop-blur">
          <LoaderCircle className="h-8 w-8 animate-spin text-[#5F52FF]" />
        </div>
      </div>
    );
  }

  if (claimResult) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#effff7,_#f8fafc_50%,_#ffffff_100%)] px-4 py-10">
        <div className="mx-auto flex max-w-2xl flex-col items-center rounded-[36px] border border-[#E6F7EE] bg-white px-6 py-12 text-center shadow-[0_30px_80px_rgba(0,208,132,0.12)] sm:px-10">
          <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-[#E8FBF4]">
            <CheckCircle2 className="h-12 w-12 text-[#00D084]" />
          </div>
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#F4F1FF] px-4 py-2 text-sm font-medium text-[#5F52FF]">
            <Sparkles className="h-4 w-4" />
            Claimed successfully
          </p>
          <h1 className="font-br-firma text-3xl font-semibold text-[#18181B] sm:text-4xl">
            Your gift has been claimed
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-[#6B7280]">
            The celebration burst is now tied to the claimed state so the
            recipient gets instant feedback without blocking any interaction.
          </p>

          {gift ? (
            <div className="mt-8 grid w-full gap-4 rounded-[28px] bg-[#F8FAFF] p-6 text-left sm:grid-cols-2">
              <div className="sm:col-span-2 flex justify-center py-4">
                <GiftRevealStage 
                  amount={gift.amount.toString()} 
                  currency={gift.currency}
                  onRevealComplete={() => {
                    playMysterySound("reveal");
                    triggerHaptic("medium");
                  }}
                />
              </div>
              <div className="border-t border-slate-100 pt-6">
                <p className="text-sm text-[#717182]">Recipient</p>
                <p className="mt-1 font-medium text-[#18181B]">
                  {gift.recipient.name || "Gift recipient"}
                </p>
              </div>
              <div className="border-t border-slate-100 pt-6">
                <p className="text-sm text-[#717182]">Amount</p>
                <p className="mt-1 font-medium text-[#18181B]">
                  {currencyFormatter(gift.currency, gift.amount)}
                </p>
              </div>
            </div>
          ) : null}

          {gift?.message ? (
             <div className="mt-6 w-full text-left">
               <p className="text-sm text-[#717182] mb-3 ml-2">Secret Message</p>
               <ScratchReveal 
                width={560} 
                height={160}
                onComplete={() => {
                   playMysterySound("reveal");
                   triggerHaptic("light");
                }}
               >
                 <p className="text-center font-medium text-slate-700 italic px-8">
                    &ldquo;{gift.message}&rdquo;
                 </p>
               </ScratchReveal>
             </div>
          ) : null}

          {claimResult.message ? (
            <p className="mt-8 text-sm text-[#717182]">{claimResult.message}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f2f5ff,_#f8fafc_55%,_#ffffff_100%)] px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-[36px] border border-white/70 bg-white/90 p-6 shadow-[0_30px_80px_rgba(90,69,254,0.12)] backdrop-blur sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-[#F4F1FF] px-4 py-2 text-sm font-medium text-[#5F52FF]">
              <Gift className="h-4 w-4" />
              Recipient flow
            </p>
            <h1 className="mt-4 font-br-firma text-3xl font-semibold text-[#18181B] sm:text-4xl">
              Claim your gift
            </h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-[#6B7280]">
              Review the gift details below, then confirm the claim to complete
              the flow.
            </p>
          </div>
          <div className="rounded-[24px] bg-[#F8FAFF] px-5 py-4 text-left">
            <p className="text-sm text-[#717182]">Unlock</p>
            <p className="mt-1 font-medium text-[#18181B]">
              {formatUnlockLabel(gift?.unlockDatetime ?? null)}
            </p>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {gift ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[28px] bg-[#F8FAFF] p-6">
              <p className="text-sm text-[#717182]">Recipient</p>
              <p className="mt-1 text-lg font-medium text-[#18181B]">
                {gift.recipient.name || "Gift recipient"}
              </p>
              <p className="mt-4 text-sm text-[#717182]">Sender</p>
              <p className="mt-1 text-lg font-medium text-[#18181B]">
                {gift.privacySettings.hideSender
                  ? "Anonymous sender"
                  : gift.senderName || "Someone special"}
              </p>
            </div>

            <div className="rounded-[28px] bg-[#F8FAFF] p-6">
              <p className="text-sm text-[#717182]">Gift amount</p>
              <p className="mt-1 text-lg font-medium text-[#18181B]">
                {gift.privacySettings.hideAmount
                  ? "Hidden until unlocked"
                  : currencyFormatter(gift.currency, gift.amount)}
              </p>
              <p className="mt-4 text-sm text-[#717182]">Processing fee</p>
              <p className="mt-1 text-lg font-medium text-[#18181B]">
                {currencyFormatter(gift.currency, gift.processingFee)}
              </p>
            </div>
          </div>
        ) : null}

        {gift?.message ? (
          <div className="mt-6 rounded-[28px] border border-[#ECEBFF] bg-[#FCFBFF] p-6">
            <p className="text-sm text-[#717182]">Message</p>
            <p className="mt-2 text-base leading-7 text-[#18181B]">
              {gift.message}
            </p>
          </div>
        ) : null}

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-[#717182]">Total value</p>
            <p className="mt-1 text-2xl font-semibold text-[#18181B]">
              {gift ? currencyFormatter(gift.currency, gift.totalAmount) : "--"}
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            isLoading={isClaiming}
            onClick={handleClaimGift}
            className="h-14 rounded-2xl px-8 font-br-firma text-base font-medium"
          >
            {isClaiming ? "Claiming..." : "Claim gift"}
          </Button>
        </div>
      </div>
    </div>
  );
}
