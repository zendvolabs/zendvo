import { NextRequest, NextResponse } from "next/server";
import { createProblemDetails } from "@/lib/api-utils";
import {
  ActivationError,
  TransactionBuilderService,
} from "@/lib/stellar/transaction_builder";

export async function POST(request: NextRequest) {
  let body: { publicKey?: unknown; targetAddress?: unknown };
  try {
    body = await request.json();
  } catch {
    return createProblemDetails(
      "about:blank",
      "Bad Request",
      400,
      "Request body must be valid JSON.",
    );
  }

  const publicKey = typeof body?.publicKey === "string" ? body.publicKey.trim() : "";
  const targetAddress =
    typeof body?.targetAddress === "string" ? body.targetAddress.trim() : "";

  if (!publicKey && !targetAddress) {
    return createProblemDetails(
      "about:blank",
      "Bad Request",
      400,
      "publicKey or targetAddress is required.",
    );
  }
  if (publicKey && targetAddress && publicKey !== targetAddress) {
    return createProblemDetails(
      "about:blank",
      "Bad Request",
      400,
      "publicKey and targetAddress must match when both are provided.",
    );
  }

  try {
    const result = await new TransactionBuilderService().buildCreateAccount({
      destination: publicKey || targetAddress,
    });

    return NextResponse.json(
      {
        success: true,
        envelopeXdr: result.envelopeXdr,
        networkPassphrase: result.networkPassphrase,
        source: result.source,
        destination: result.destination,
        startingBalance: result.startingBalance,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ActivationError) {
      if (error.status >= 500) {
        console.error("Error in wallet/activate:", error.code, error.message);
      }
      return createProblemDetails(
        "about:blank",
        error.status >= 500 ? "Internal Server Error" : "Bad Request",
        error.status,
        error.message,
      );
    }
    console.error("Error in wallet/activate:", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Internal server error",
    );
  }
}
