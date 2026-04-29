"use client";

import React, { useState } from "react";
import Button from "@/components/Button";
import { Input } from "@/components/Input";
import Card from "@/components/Card";
import { Search, MessageSquare, Calendar, Shield, Clock, Info, Check } from "lucide-react";

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
  const processingFee = amountNum * 0.02; // 2% fee
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
    <div className="w-full flex justify-center px-4 py-8 md:py-12 bg-gray-50/50 min-h-screen">
      <Card
        className="w-full max-w-[480px] rounded-[32px] shadow-xl border-none overflow-hidden"
      >
        <div className="p-2">
          <div className="px-6 pt-6 pb-2">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Customize Gift</h1>
            <p className="text-sm text-gray-500 mt-1">Specify recipient, amount, and a personalized message.</p>
          </div>

          <div className="p-6 space-y-8">
            {/* Recipient Input */}
            <div className="space-y-2">
              <Input
                label="Recipient"
                placeholder="Search by name, email or @username"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                icon={<Search size={18} className="text-gray-400" />}
              />
            </div>

            {/* Amount Field */}
            <div className="space-y-4">
              <div className="relative">
                <Input
                  label="Amount"
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="text-lg font-semibold"
                  suffix={<span className="text-sm font-bold text-gray-400">NGN</span>}
                />
              </div>

              {/* Preset Amount Chips */}
              <div className="flex gap-2">
                {PRESET_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset.toString())}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 border ${
                      amount === String(preset)
                        ? "bg-[#5A45FE] border-[#5A45FE] text-white shadow-lg shadow-[#5A45FE]/20 ring-2 ring-[#5A45FE]/10"
                        : "bg-white border-gray-100 text-gray-600 hover:border-[#5A45FE]/30 hover:bg-gray-50"
                    }`}
                  >
                    ₦{preset.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            {/* Personal Message */}
            <div className="space-y-4">
              <div className="w-full relative">
                <label className="block absolute -top-2.5 left-4 px-1 bg-white z-10 text-[11px] font-medium text-gray-400 pointer-events-none">
                  Personal Message
                </label>
                <div className="relative">
                  <textarea
                    rows={4}
                    placeholder="Add a heartwarming note..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full px-4 py-4 rounded-2xl bg-white border border-gray-200 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#5A45FE]/20 focus:border-[#5A45FE] resize-none transition-all duration-200"
                  />
                  <div className="absolute bottom-3 right-3 text-gray-300">
                    <MessageSquare size={16} />
                  </div>
                </div>
              </div>

              {/* Message Templates */}
              <div className="flex flex-wrap gap-2">
                {MESSAGE_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setMessage(tpl)}
                    className="px-4 py-2 rounded-xl text-[12px] font-medium bg-gray-50 border border-gray-100 text-gray-600 hover:bg-white hover:border-[#5A45FE]/30 hover:text-[#5A45FE] transition-all duration-200"
                  >
                    {tpl}
                  </button>
                ))}
              </div>
            </div>

            {/* Privacy & Settings Section */}
            <div className="pt-2 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Shield size={16} className="text-[#5A45FE]" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Privacy & Settings</span>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={() => setHideAmount(!hideAmount)}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 ${hideAmount ? "border-[#5A45FE] bg-[#5A45FE]/5" : "border-gray-100 bg-gray-50/50 hover:bg-gray-50"}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${hideAmount ? "bg-[#5A45FE] text-white" : "bg-white text-gray-400 shadow-sm"}`}>
                      <Info size={16} />
                    </div>
                    <span className={`text-[13px] font-medium ${hideAmount ? "text-gray-900" : "text-gray-600"}`}>Hide amount from recipient</span>
                  </div>
                  {hideAmount && <Check size={18} className="text-[#5A45FE]" />}
                </button>

                <button 
                  onClick={() => setIsAnonymous(!isAnonymous)}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 ${isAnonymous ? "border-[#5A45FE] bg-[#5A45FE]/5" : "border-gray-100 bg-gray-50/50 hover:bg-gray-50"}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isAnonymous ? "bg-[#5A45FE] text-white" : "bg-white text-gray-400 shadow-sm"}`}>
                      <Shield size={16} />
                    </div>
                    <span className={`text-[13px] font-medium ${isAnonymous ? "text-gray-900" : "text-gray-600"}`}>Send as Anonymous</span>
                  </div>
                  {isAnonymous && <Check size={18} className="text-[#5A45FE]" />}
                </button>
              </div>
            </div>

            {/* Scheduling */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-[#5A45FE]" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Schedule (Optional)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="date"
                  value={unlockDate}
                  onChange={(e) => setUnlockDate(e.target.value)}
                  icon={<Calendar size={16} className="text-gray-400" />}
                />
                <Input
                  type="time"
                  value={unlockTime}
                  onChange={(e) => setUnlockTime(e.target.value)}
                  icon={<Clock size={16} className="text-gray-400" />}
                />
              </div>
            </div>

            {/* Summary Breakdown */}
            <div className="p-5 rounded-3xl bg-[#5A45FE]/[0.03] border border-[#5A45FE]/10 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 font-medium">Gift Amount</span>
                <span className="font-bold text-gray-900">₦{amountNum.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1.5 text-gray-500">
                  <span className="font-medium">Processing Fee</span>
                  <Info size={12} className="opacity-50" />
                </div>
                <span className="font-bold text-gray-900">₦{processingFee.toLocaleString()}</span>
              </div>
              <div className="pt-3 mt-1 border-t border-[#5A45FE]/10 flex justify-between items-center">
                <span className="font-bold text-gray-900">Total to Pay</span>
                <span className="text-xl font-extrabold text-[#5A45FE]">₦{totalAmount.toLocaleString()}</span>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              onClick={handleSendGift}
              disabled={!isFormValid}
              className={`w-full h-14 rounded-2xl text-base font-bold shadow-xl transition-all duration-300 ${isFormValid ? "shadow-[#5A45FE]/20 hover:scale-[1.02] active:scale-[0.98]" : "opacity-50 cursor-not-allowed"}`}
            >
              Continue to Review
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
