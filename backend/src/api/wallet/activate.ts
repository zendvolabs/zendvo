import { NextRequest, NextResponse } from "next/server";
import { TransactionBuilderService } from "../../lib/stellar/transaction_builder";
import { StrKey } from "@stellar/stellar-sdk";

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, any>;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const publicKey = body.publicKey || body.targetAddress;

    if (!publicKey) {
      return NextResponse.json(
        { message: "publicKey is required" },
        { status: 400 }
      );
    }

    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      return NextResponse.json(
        { message: "Invalid Stellar public key" },
        { status: 400 }
      );
    }

    const xdr = await TransactionBuilderService.buildCreateAccountXdr(publicKey);

    return NextResponse.json(
      { success: true, xdr },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[ACTIVATE_WALLET_ERROR]", error);
    return NextResponse.json(
      { message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
