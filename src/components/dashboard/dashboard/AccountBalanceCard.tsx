"use client";

import {
  BankIcon,
  CoinIcon,
  GiftSentIcon,
  MoneyBag,
  WithdrawalIcon,
} from "@/assets/svg";
import WithdrawalSuccessModal from "@/components/dashboard/withdrawal/WithdrawalSuccessModal";
import { Copy } from "lucide-react";
import { useState } from "react";

const DEMO_WITHDRAWAL_AMOUNT = 250;

export const AccountBalanceCard = () => {
  const [isWithdrawalSuccessOpen, setIsWithdrawalSuccessOpen] = useState(false);

  return (
    <div className="p-6 bg-white w-full sm:max-w-102.25 rounded-4xl space-y-8">
      <div className="space-y-5">
        <div>
          <div>
            <div className="flex items-center justify-between w-full mb-2">
              <div>
                <span className="leading-6 text-base text-[#18181B] flex items-center">
                  <span className="mr-2 inline-flex items-center justify-center size-6 bg-[#F7F7FC] rounded-full ">
                    <MoneyBag />
                  </span>
                  Account Balance
                </span>
              </div>
              <div className="py-1 px-3 rounded-3xl border border-[#F5F6F7] bg-[#F5F6F7] uppercase text-sm font-medium text-[#17171C] gap-x-2 items-center justify-center flex ">
                <CoinIcon />
                usdt
              </div>
            </div>
          </div>
          <p className="text-2xl font-semibold leading-8 text-[#18181B] tracking-[0%]">
            $10,000
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="flex items-center justify-between gap-6 min-w-max">
            <div className="flex items-center flex-col gap-2">
              <div className="bg-[#5A42DE] size-10 rounded-xl flex justify-center items-center">
                <GiftSentIcon />
              </div>
              <p className="text-sm leading-5 text-[#18181B] whitespace-nowrap">
                Send Gift
              </p>
            </div>
            <div className="flex items-center flex-col gap-2">
              <div className="bg-[#5A42DE] size-10 rounded-xl flex justify-center items-center">
                <BankIcon />
              </div>
              <p className="text-sm leading-5 text-[#18181B] whitespace-nowrap">
                Add a Bank
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsWithdrawalSuccessOpen(true)}
              className="flex items-center flex-col gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5A42DE] focus-visible:ring-offset-2"
              aria-label="Withdraw funds"
            >
              <span className="bg-[#5A42DE] size-10 rounded-xl flex justify-center items-center">
                <WithdrawalIcon />
              </span>
              <span className="text-sm leading-5 text-[#18181B] whitespace-nowrap">
                Withdraw
              </span>
            </button>
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-base leading-6 text-[#18181B] ">
          Zendvo account details
        </p>
        <div className="p-5 h-25 border border-[#C9CEFC] rounded-2xl bg-[#F7F7FC] space-y-1">
          <div>
            <div className="flex justify-between items-center w-full">
              <p className="text-lg font-semibold leading-6  text-[#18181B]">
                8112345678
              </p>
              <button className="flex gap-2 h-8 text-sm font-medium leading-5 text-[#18181B] items-center  justify-center px-2 bg-white rounded-full py-2.5">
                <Copy className="text-[#5A42DE]" /> <span>Copy</span>
              </button>
            </div>
            <p className="leading-6 text-[#18181B]">Somtochukwu Eze</p>
          </div>
        </div>
      </div>

      <WithdrawalSuccessModal
        isOpen={isWithdrawalSuccessOpen}
        amount={DEMO_WITHDRAWAL_AMOUNT}
        onClose={() => setIsWithdrawalSuccessOpen(false)}
      />
    </div>
  );
};
