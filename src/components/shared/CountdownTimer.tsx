"use client";

import { useEffect, useState } from "react";

interface CountdownTimerProps {
  targetDate: Date;
  sentOn?: string;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
}

function getTimeLeft(target: Date): TimeLeft {
  const diff = Math.max(0, target.getTime() - Date.now());
  const totalMinutes = Math.floor(diff / 1000 / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  return { days, hours, minutes };
}

function DigitBlock({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center justify-center w-9 h-9 md:w-11 md:h-11 rounded-xl bg-[#5A42DE] text-white text-lg md:text-xl font-bold font-br-firma">
      {value}
    </span>
  );
}

function DigitGroup({ value, digits }: { value: number; digits: number }) {
  const padded = String(value).padStart(digits, "0");
  return (
    <div className="flex gap-1">
      {padded.split("").map((d, i) => (
        <DigitBlock key={i} value={d} />
      ))}
    </div>
  );
}

export const CountdownTimer = ({ targetDate, sentOn }: CountdownTimerProps) => {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() =>
    getTimeLeft(targetDate),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(getTimeLeft(targetDate));
    }, 60_000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return (
    <div className="flex flex-col items-center gap-5 bg-white rounded-3xl px-6 py-8">
      <p className="text-[#5A42DE] text-2xl md:text-3xl font-bold cherry-bomb-one tracking-wide ">
        Count down
      </p>

      <div className="flex items-end gap-3 md:gap-4">
        {/* Days */}
        <div className="flex flex-col items-center gap-2">
          <DigitGroup value={timeLeft.days} digits={3} />
          <span className="text-sm text-[#18181B]">Days</span>
        </div>

        <span className="text-[#5A42DE] text-2xl font-bold mb-6">:</span>

        {/* Hours */}
        <div className="flex flex-col items-center gap-2">
          <DigitGroup value={timeLeft.hours} digits={2} />
          <span className="text-sm text-[#18181B]">Hours</span>
        </div>

        <span className="text-[#5A42DE] text-2xl font-bold mb-6">:</span>

        {/* Minutes */}
        <div className="flex flex-col items-center gap-2">
          <DigitGroup value={timeLeft.minutes} digits={2} />
          <span className="text-sm text-[#18181B]">Minutes</span>
        </div>
      </div>

      {sentOn && (
        <p className="text-sm text-[#717182]">
          Sent on <span className="font-bold text-[#5A42DE]">{sentOn}</span>
        </p>
      )}
    </div>
  );
};
