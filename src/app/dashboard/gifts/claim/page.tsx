import { ClaimGiftView } from "@/components/gifting/ClaimGiftView";

const ClaimGiftPage = () => {
  return (
    <ClaimGiftView
      amount="$1,000"
      sentOn="12 Dec 2026 : 8:45pm"
      sender={{
        name: "Somtochukwu Eze",
        email: "somtochukwueze@gmail.com",
      }}
      message="Someone thought of you and sent a special surprise. This gift was saved just for this moment. Open it and enjoy every bit 💝"
    />
  );
};

export default ClaimGiftPage;
