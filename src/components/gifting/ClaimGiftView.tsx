"use client";

import Image from "next/image";
import Button from "@/components/Button";
import Bg from "@/assets/images/gift_unlock_bg.png";
interface SenderDetail {
  name: string;
  email: string;
  avatarUrl?: string;
}

interface ClaimGiftViewProps {
  amount: string;
  sentOn: string;
  sender: SenderDetail;
  message: string;
  onClaim?: () => void;
}

export const ClaimGiftView = ({
  amount,
  sentOn,
  sender,
  message,
  onClaim,
}: ClaimGiftViewProps) => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#F7F7FC]  px-4 pt-5 md:pt-11">
      <div
        style={{
          backgroundImage: `url(${Bg.src})`,
        }}
        className="w-full max-w-110 rounded-4xl  overflow-hidden p-6 bg-cover bg-no-repeat bg-center"
      >
        {/* Top section: gift illustration */}
        <div className="size-52.75 rounded-full bg-[#C9CEFC] p-1.25 flex items-center justify-center shadow-inner mx-auto overflow-hidden">
          <video
            src="/original-587485d48ea665e20b1d1b6a6242dd63.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover rounded-full"
          />
        </div>
        <div className="flex flex-col items-center gap-3  pt-3 pb-3">
          {/* Gift circle — gray background, no confetti */}

          {/* Title */}
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-white text-4xl font-bold font-br-firma leading-tight cherry-bomb-one">
              Gift Unlocked!
            </h1>
            <p className="text-white text-sm font-medium leading-5 tracking-[0%]">
              The wait is over 🎁 Your gift has unlocked, and everything inside
              is now visible. You can withdraw your money whenever you’re ready.
            </p>
          </div>

          {/* Amount */}
          <p className="text-white text-5xl font-bold tracking-tight cherry-bomb-one">
            {amount}
          </p>

          {/* Sent on */}
          <p className="text-white text-sm">
            Sent on <span className="font-bold text-white">{sentOn}</span>
          </p>
        </div>

        {/* Bottom white card */}
        <div className="bg-white rounded-3xl p-4 flex flex-col gap-2.25">
          {/* Sender detail */}
          <div className="flex flex-col gap-2.25">
            <p className="text-sm font-medium text-[#18181B] leading-5 tracking-[0%]">
              Sender detail
            </p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-[#E5E7EB] shrink-0">
                {sender.avatarUrl ? (
                  <Image
                    src={sender.avatarUrl}
                    alt={sender.name}
                    width={40}
                    height={40}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#5A42DE]/10 text-[#5A42DE] text-sm font-semibold">
                    {sender.name[0]?.toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-px">
                <p className="text-base font-medium text-[#18181B]">
                  {sender.name}
                </p>
                <p className="text-sm font-medium text-[#71717A]">
                  {sender.email}
                </p>
              </div>
            </div>
          </div>

          {/* Message */}
          <div className="flex flex-col gap-2.25">
            <p className="text-sm font-semibold text-[#18181B]">Message:</p>
            <p className="text-xs text-[#71717A] leading-relaxed">{message}</p>
          </div>

          {/* CTA */}
          <Button onClick={onClaim} className="cursor-pointer">
            Redeem Gift
          </Button>
        </div>
      </div>
    </div>
  );
};
