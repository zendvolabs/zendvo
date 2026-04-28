"use client";

import React, { useState } from "react";
import Button from "@/components/Button";
import { Input } from "@/components/Input";
import Card from "@/components/Card";

const PRESET_AMOUNTS = [100, 500, 1000];

export default function GiftCustomization() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [message, setMessage] = useState("");

  const handleSendGift = () => {
    if (!recipient.trim() || !amount || parseFloat(amount) <= 0) return;

    console.log("Gift Sent:", {
      recipient,
      amount,
      message,
    });
  };

  const isFormValid = recipient.trim() !== "" && amount !== "" && parseFloat(amount) > 0;

  return (
    <div className="w-full flex justify-center px-4 py-10">
      <Card
        title="Customize Gift"
        description="Specify recipient, amount, and a personalized message."
        className="w-full max-w-[400px] rounded-3xl"
      >
        <div className="space-y-5">
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
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Personal Message */}
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

          {/* Submit Button */}
          <Button
            onClick={handleSendGift}
            disabled={!isFormValid}
            className="w-full h-12 mt-2 rounded-xl"
          >
            Send Gift
          </Button>
        </div>
      </Card>
    </div>
  );
}
