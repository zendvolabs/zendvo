import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthPayload } from "@/lib/auth-session";
import { createProblemDetails } from "@/lib/api-utils";
import {
  findGiftMetadataByContractId,
  upsertGiftMetadata,
} from "@/server/db/giftMetadataRepository";

// On-chain gift IDs are numeric counters issued by the Soroban gift contract,
// but the column is text so other identifier schemes remain possible.
const contractGiftIdSchema = z
  .union([z.string().trim().min(1).max(128), z.number().int().positive()])
  .transform((v) => String(v));

const giftMetadataSchema = z.object({
  contractGiftId: contractGiftIdSchema,
  message: z.string().trim().max(1000).nullish(),
  hideAmount: z.boolean().optional(),
  stayAnonymous: z.boolean().optional(),
  imageUrl: z.string().trim().url().max(2048).nullish(),
  processingFee: z.number().min(0).max(1_000_000).optional(),
  status: z.enum(["pending", "indexed", "confirmed", "failed"]).optional(),
});

function serialize(record: {
  id: string;
  contractGiftId: string;
  message: string | null;
  hideAmount: boolean;
  stayAnonymous: boolean;
  imageUrl: string | null;
  processingFee: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    contractGiftId: record.contractGiftId,
    message: record.message,
    hideAmount: record.hideAmount,
    stayAnonymous: record.stayAnonymous,
    imageUrl: record.imageUrl,
    processingFee: record.processingFee,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Unauthorized");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Request body must be valid JSON",
      );
    }

    const parsed = giftMetadataSchema.safeParse(body);
    if (!parsed.success) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "Invalid input data",
      );
    }

    const { contractGiftId, ...fields } = parsed.data;

    const existing = await findGiftMetadataByContractId(contractGiftId);
    if (existing && existing.userId !== payload.userId) {
      return createProblemDetails(
        "about:blank",
        "Conflict",
        409,
        "Gift metadata for this contract gift ID is already indexed",
      );
    }

    const record = await upsertGiftMetadata({
      contractGiftId,
      userId: payload.userId,
      ...fields,
    });

    return NextResponse.json(
      {
        success: true,
        message: existing
          ? "Gift metadata updated successfully"
          : "Gift metadata indexed successfully",
        data: serialize(record),
      },
      { status: existing ? 200 : 201 },
    );
  } catch (error) {
    console.error("[GIFT_METADATA_INDEX_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to index gift metadata",
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const payload = await getAuthPayload(request);
    if (!payload) {
      return createProblemDetails("about:blank", "Unauthorized", 401, "Unauthorized");
    }

    const contractGiftId = request.nextUrl.searchParams.get("contractGiftId");
    const parsedId = contractGiftIdSchema.safeParse(contractGiftId);
    if (!parsedId.success) {
      return createProblemDetails(
        "about:blank",
        "Bad Request",
        400,
        "A valid contractGiftId query parameter is required",
      );
    }

    const record = await findGiftMetadataByContractId(parsedId.data);
    if (!record || record.userId !== payload.userId) {
      return createProblemDetails(
        "about:blank",
        "Not Found",
        404,
        "Gift metadata not found",
      );
    }

    return NextResponse.json({
      success: true,
      data: serialize(record),
    });
  } catch (error) {
    console.error("[GIFT_METADATA_GET_ERROR]", error);
    return createProblemDetails(
      "about:blank",
      "Internal Server Error",
      500,
      "Failed to retrieve gift metadata",
    );
  }
}
