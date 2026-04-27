import React from "react";
import { BalanceSelection } from "@/components/dashboard/withdrawal/BalanceSelection";

import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Withdraw Gift | Zendvo",
  description: "Withdraw your gift balance to your bank account.",
};

const WithdrawPage = () => {
  return <BalanceSelection />;
};

export default WithdrawPage;
