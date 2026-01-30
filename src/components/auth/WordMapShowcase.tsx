import React from "react";
import MapImage from "../../../public/map.png";
import Image from "next/image";
import { motion } from "framer-motion";
import { Gift } from "lucide-react";

interface CurrencyCardProps {
  type: "sent" | "received";
  amount: string;
  flag: string;
  currency: string;
  tailPosition?: "top" | "bottom";
}

const CurrencyCard: React.FC<CurrencyCardProps> = ({
  type,
  amount,
  flag,
  currency,
  tailPosition = "top",
}) => {
  const isSent = type === "sent";
  return (
    <div className="relative group">
      <div className="flex items-center gap-3 bg-white p-3 rounded-2xl shadow-lg min-w-[180px] hover:scale-105 transition-transform duration-300 cursor-default relative z-10">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center ${isSent ? "bg-red-100" : "bg-purple-100"}`}
        >
          <Gift
            className={`w-5 h-5 ${isSent ? "text-red-500" : "text-[#6c5ce7]"}`}
          />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-[#717182] font-medium uppercase tracking-wide">
            {isSent ? "Gift Sent" : "Gift Received"}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-base text-[#18181B] font-bold">
              {currency}
            </span>
            <span className="text-base text-[#18181B] font-bold">{amount}</span>
          </div>
        </div>
      </div>
      {tailPosition === "top" ? (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white transform rotate-45 shadow-[0_-2px_4px_rgba(0,0,0,0.02)] z-20"></div>
      ) : (
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-4 h-4 bg-white transform -translate-y-2 rotate-45 shadow-sm z-0"></div>
      )}
    </div>
  );
};

export const WorldMapShowcase: React.FC = () => {
  return (
    <div className="relative w-full">
      <div className="max-w-148.25 mx-auto px-4">
        <h2 className="md:text-5xl xl:text-6xl font-bold text-[#18181B] mb-12 text-left leading-tight">
          Receive/Send & cash gift across the globe
        </h2>
      </div>

      <div className="relative w-full aspect-[1.8/1] mx-auto">
        <Image
          src={MapImage}
          alt="Global map visualization"
          className="opacity-80"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeInOut" }}
          className="absolute left-[8%] top-[30%]"
        >
          <CurrencyCard
            type="sent"
            amount="200.00"
            currency="CAD"
            flag="🇨🇦"
            tailPosition="top"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeInOut", delay: 0.2 }}
          className="absolute left-[50%] top-[33%]"
        >
          <CurrencyCard
            type="received"
            amount="245,000.00"
            currency="NGN"
            flag="🇳🇬"
            tailPosition="bottom"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeInOut", delay: 0.4 }}
          className="absolute left-[41%] top-[58%]"
        >
          <CurrencyCard
            type="received"
            amount="200.00"
            currency="GHS"
            flag="🇬🇭"
            tailPosition="top"
          />
        </motion.div>
      </div>
    </div>
  );
};
