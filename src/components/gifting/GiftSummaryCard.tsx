export interface GiftDetail {
  label: string;
  value: string;
  valueClassName?: string;
  isLarge?: boolean;
  isColumn?: boolean;
}

interface GiftSummaryCardProps {
  details: GiftDetail[];
  onCopyLink?: () => void;
}

const ShareIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const rowLabel = "text-sm text-[#18181B] font-medium";
const rowValue = "text-sm text-[#717182] text-right";

export const GiftSummaryCard = ({ details, onCopyLink }: GiftSummaryCardProps) => {
  return (
    <div className="bg-white rounded-3xl p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[#18181B]">Gift Details</h2>
        <button
          aria-label="Share gift"
          className="text-[#18181B] hover:text-[#5A42DE] transition-colors"
        >
          <ShareIcon />
        </button>
      </div>

      <div className="rounded-2xl border border-[#EEEEF3] bg-[#FAFAFB] p-4 space-y-3">
        {details.map((row, i) => (
          <div key={i}>
            {i > 0 && <div className="border-t border-[#EEEEF3] pt-3" />}
            {row.isColumn ? (
              <div className="flex flex-col gap-1.5">
                <p className={rowLabel}>{row.label}</p>
                <p className={`text-sm text-[#717182] ${row.valueClassName ?? ""}`}>
                  {row.value}
                </p>
              </div>
            ) : (
              <div className="flex justify-between items-start gap-4">
                <p className={rowLabel}>{row.label}</p>
                {row.isLarge ? (
                  <p className="text-[32px] font-semibold text-[#18181B] leading-none">
                    {row.value}
                  </p>
                ) : (
                  <p className={`${rowValue} ${row.valueClassName ?? ""}`}>
                    {row.value}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={onCopyLink}
        className="w-full h-12 rounded-xl bg-[#5A42DE] hover:bg-[#4E37CC] text-white font-semibold transition-colors"
      >
        Copy Link
      </button>
    </div>
  );
};
