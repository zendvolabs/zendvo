import { LockedGiftState } from "@/components/gifting/LockedGiftState";

const MOCK_UNLOCK_DATE = new Date("2026-12-31T11:30:00");

const MOCK_DETAILS = [
  { label: "Recipient", value: "John Eze (NGN)\n8112345678" },
  { label: "Amount", value: "$200" },
  { label: "Processing Fee", value: "$4" },
  { label: "Total Amount", value: "$204", isLarge: true },
  { label: "Amount Privacy", value: "Hide amount sent" },
  { label: "Sender Privacy", value: "Anonymous" },
  { label: "Unlock date and time", value: "31 Dec, 2026 11:30am" },
  {
    label: "Status",
    value: "Unlocked",
    valueClassName: "text-[#5A42DE] font-semibold",
  },
  {
    label: "Message for the sender",
    value:
      "Someone thought of you and sent a special surprise. This gift was saved just for this moment. Open it and enjoy every bit 💝",
    isColumn: true,
  },
];

const GiftDetailPage = () => {
  return (
    <div className="min-h-screen bg-[#F7F7FC] p-4 md:p-6 rounded-4xl">
      <LockedGiftState
        unlockDate={MOCK_UNLOCK_DATE}
        sentOn="12 Dec 2026 : 8:45pm"
        details={MOCK_DETAILS}
      />
    </div>
  );
};

export default GiftDetailPage;
