import { GiftSummaryCard, GiftDetail } from "@/components/gifting/GiftSummaryCard";
import { GiftSharePreview } from "@/components/gifting/GiftSharePreview";

export type { GiftDetail };

interface LockedGiftStateProps {
  unlockDate: Date;
  sentOn: string;
  details: GiftDetail[];
  onCopyLink?: () => void;
}

export const LockedGiftState = ({
  unlockDate,
  sentOn,
  details,
  onCopyLink,
}: LockedGiftStateProps) => {
  return (
    <div className="flex flex-col xl:flex-row gap-6 p-4 md:p-6 max-w-224.5 mx-auto">
      {/* Left: details + mobile preview */}
      <div className="w-full xl:max-w-110 flex flex-col gap-4">
        <div className="xl:hidden">
          <GiftSharePreview
            unlockDate={unlockDate}
            sentOn={sentOn}
            height="h-85.75"
          />
        </div>
        <GiftSummaryCard details={details} onCopyLink={onCopyLink} />
      </div>

      {/* Right: video + countdown (desktop only) */}
      <div className="hidden xl:flex flex-col gap-4 flex-1">
        <GiftSharePreview unlockDate={unlockDate} sentOn={sentOn} />
      </div>
    </div>
  );
};
