"use client";

import React, { useState } from "react";
import Button from "@/components/Button";
import { Input } from "@/components/Input";
import Card from "@/components/Card";

const PRESET_AMOUNTS = [100, 500, 1000];
const MESSAGE_TEMPLATES = [
  "Thank you so much! This made my day 💝",
  "I'm speechless! Thank you for thinking of me ❤️",
  "Best surprise ever! Thank you 🎉",
];

export default function GiftCustomization() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [message, setMessage] = useState("");
  const [hideAmount, setHideAmount] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [unlockDate, setUnlockDate] = useState("");
  const [unlockTime, setUnlockTime] = useState("");

  const amountNum = parseFloat(amount) || 0;
  const processingFee = amountNum * 0.02; // 2% fee as seen in other components
  const totalAmount = amountNum + processingFee;

  const handleSendGift = () => {
    if (!recipient.trim() || !amount || amountNum <= 0) return;

    console.log("Gift Sent:", {
      recipient,
      amount,
      message,
      hideAmount,
      isAnonymous,
      unlockDate,
      unlockTime,
      totalAmount,
    });
  };

  const isFormValid = recipient.trim() !== "" && amount !== "" && amountNum > 0;

  return (
    <div className="w-full flex justify-center px-4 py-10">
      <Card
        title="Customize Gift"
        description="Specify recipient, amount, and a personalized message."
        className="w-full max-w-[480px] rounded-3xl"
      >
        <div className="space-y-6">
          {/* Recipient Input */}
          <Input
            label="Recipient"
            placeholder="Enter recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />

          {/* Amount Field */}
          <div className="space-y-3">
            <Input
              label="Amount"
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />

            {/* Preset Amount Chips */}
            <div className="flex gap-2">
              {PRESET_AMOUNTS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset.toString())}
                  className={`px-4 py-2 rounded-full text-xs font-medium transition-colors border ${
                    amount === String(preset)
                      ? "bg-[#5A45FE] border-[#5A45FE] text-white"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  ₦{preset}
                </button>
              ))}
            </div>
          </div>

          {/* Personal Message */}
          <div className="space-y-3">
            <div className="w-full relative">
              <label className="block absolute -top-2.5 left-4 px-1 bg-white text-[11px] text-gray-400 pointer-events-none">
                Personal Message
              </label>
              <textarea
                rows={4}
                placeholder="Enter your message (optional)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full px-4 py-3.5 rounded-lg bg-white border border-gray-200 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#5A45FE] focus:border-[#5A45FE] resize-none transition-all"
              />
            </div>

            {/* Message Templates */}
            <div className="flex flex-wrap gap-2">
              {MESSAGE_TEMPLATES.map((tpl) => (
                <button
                  key={tpl}
                  type="button"
                  onClick={() => setMessage(tpl)}
                  className="px-3 py-1.5 rounded-lg text-[11px] border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  {tpl}
                </button>
              ))}
            </div>
          </div>

          {/* Privacy Toggles */}
          <div className="flex flex-col gap-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={hideAmount}
                onChange={(e) => setHideAmount(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-[#5A45FE] focus:ring-[#5A45FE]"
              />
              <span className="text-[13px] text-gray-700 group-hover:text-gray-900 transition-colors">
                Hide amount from Recipient
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-[#5A45FE] focus:ring-[#5A45FE]"
              />
              <span className="text-[13px] text-gray-700 group-hover:text-gray-900 transition-colors">
                Send as Anonymous
              </span>
            </label>
          </div>

          {/* Scheduling */}
          <div className="space-y-3 pt-2">
            <label className="block text-xs font-medium text-gray-500 px-1">
              Unlock Date & Time (Optional)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                value={unlockDate}
                onChange={(e) => setUnlockDate(e.target.value)}
              />
              <Input
                type="time"
                value={unlockTime}
                onChange={(e) => setUnlockTime(e.target.value)}
              />
            </div>
          </div>

          {/* Summary Breakdown */}
          <div className="mt-6 p-4 rounded-2xl bg-gray-50 border border-gray-100 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Gift Amount</span>
              <span className="font-medium text-gray-900">₦{amountNum.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Processing Fee (2%)</span>
              <span className="font-medium text-gray-900">₦{processingFee.toLocaleString()}</span>
            </div>
            <div className="pt-2 mt-2 border-t border-gray-200 flex justify-between items-center">
              <span className="font-semibold text-gray-900">Total</span>
              <span className="text-lg font-bold text-[#5A45FE]">₦{totalAmount.toLocaleString()}</span>
            </div>
          </div>

          {/* Submit Button */}
          <Button
            onClick={handleSendGift}
            disabled={!isFormValid}
            className="w-full h-12 mt-2 rounded-xl text-base"
          >
            Proceed
          </Button>
        </div>
      </Card>
    </div>
  );
}
