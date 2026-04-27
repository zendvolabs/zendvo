import { OpenGiftIcon } from "@/assets/svg";
import Link from "next/link";

export const GiftInfoCard = () => {
  return (
    <div className="rounded-2xl py-8 px-6 lg:max-w-86.25 bg-white space-y-4 ">
      <OpenGiftIcon />
      <p className="text-xl leading-7 text-[#18181B]  tracking-[0%]">
        Do you know you can gift a friend without login?
      </p>
      <Link
        href={"/"}
        className="text-2xl underline underline-offset-3 font-bold text-[#5A42DE]"
      >
        Learn More
      </Link>
    </div>
  );
};
