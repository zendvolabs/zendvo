import { CountdownTimer } from "@/components/shared/CountdownTimer";

interface GiftSharePreviewProps {
  unlockDate: Date;
  sentOn: string;
  videoSrc?: string;
  height?: string;
}

export const GiftSharePreview = ({
  unlockDate,
  sentOn,
  videoSrc = "/original-587485d48ea665e20b1d1b6a6242dd63.mp4",
  height = "h-96.75",
}: GiftSharePreviewProps) => {
  return (
    <div className="flex flex-col gap-4">
      <div className={`rounded-3xl overflow-hidden bg-[#2B1FBF] ${height}`}>
        <video
          src={videoSrc}
          autoPlay
          loop
          muted
          playsInline
          className="w-full object-cover h-full"
        />
      </div>
      <CountdownTimer targetDate={unlockDate} sentOn={sentOn} />
    </div>
  );
};
