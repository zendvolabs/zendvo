"use client";

import React from "react";
import Card from "../../Card";
import Button from "../../Button";
import { ChevronDown } from "lucide-react";

export const BalanceSelection = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] p-4">
      <div className="w-full max-w-[480px] space-y-8">
        

        <Card className="p-8 border-none shadow-[0px_8px_30px_rgba(0,0,0,0.04)] rounded-[32px]">
          <div className="text-left space-y-6">
          <h1 className="text-3xl font-bold text-[#18181B]">Withdraw your gift</h1>
          <p className="text-[#717182] text-base ">
            Choose where you'd like your money sent.
          </p>
        </div>
          <div className="space-y-6 ">
            {/* Gift Balance Selection */}
            <div className="space-y-4">
             
              <div className="relative flex items-center justify-between p-5 border-2 border-[#5A45FE] rounded-2xl mt-5 bg-[#F7F7FC]">
                <div className="flex items-center  gap-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-sm overflow-hidden border border-gray-100">
                    <span className="text-xl">🇺🇸</span>
                  </div>
                  <div className="space-y-0.5">
                    <p className="font-bold text-lg text-[#18181B]">USD: $500.00</p>
                    <p className="text-xs text-[#717182]">Current balance</p>
                  </div>
                </div>
                <div className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-[#5A45FE]">
                  <div className="w-3 h-3 rounded-full bg-[#5A45FE]"></div>
                </div>
              </div>
            </div>

            {/* Bank Account Selection */}
            <div className="space-y-4">
              <div className="w-full relative">
                <label className="block absolute -top-2.5 left-4 px-1 bg-white text-[11px] text-[#9CA3AF] pointer-events-none z-10">
                  Select bank account
                </label>
                <button className="w-full flex items-center justify-between px-5 py-4 rounded-2xl bg-white border border-[#E5E7EB] text-[#d1d1d8] text-base focus:outline-none focus:ring-1 focus:ring-[#5A45FE] focus:border-[#5A45FE] transition-all">
                  <span>Select bank account</span>
                  <ChevronDown className="w-5 h-5 text-[#9CA3AF]" />
                </button>
              </div>
            </div>

            <Button variant="primary" className="w-full py-4 rounded-2xl text-lg font-bold">
              Continue
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};


