import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { giftsMetadata } from "@/lib/db/schema";

export interface GiftMetadataRecord {
  id: string;
  contractGiftId: string;
  userId: string;
  message: string | null;
  hideAmount: boolean;
  stayAnonymous: boolean;
  imageUrl: string | null;
  processingFee: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertGiftMetadataInput {
  contractGiftId: string;
  userId: string;
  message?: string | null;
  hideAmount?: boolean;
  stayAnonymous?: boolean;
  imageUrl?: string | null;
  processingFee?: number;
  status?: string;
}

function toRecord(row: typeof giftsMetadata.$inferSelect): GiftMetadataRecord {
  return {
    id: row.id,
    contractGiftId: row.contractGiftId,
    userId: row.userId,
    message: row.message,
    hideAmount: row.hideAmount,
    stayAnonymous: row.stayAnonymous,
    imageUrl: row.imageUrl,
    processingFee: row.processingFee,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findGiftMetadataByContractId(
  contractGiftId: string,
): Promise<GiftMetadataRecord | null> {
  const row = await db.query.giftsMetadata.findFirst({
    where: eq(giftsMetadata.contractGiftId, contractGiftId),
  });

  return row ? toRecord(row) : null;
}

export async function upsertGiftMetadata(
  input: UpsertGiftMetadataInput,
): Promise<GiftMetadataRecord> {
  const now = new Date();

  const values: Partial<typeof giftsMetadata.$inferInsert> = {
    contractGiftId: input.contractGiftId,
    userId: input.userId,
    updatedAt: now,
  };
  const set: Partial<typeof giftsMetadata.$inferInsert> = { updatedAt: now };

  if (input.message !== undefined) {
    values.message = input.message;
    set.message = input.message;
  }
  if (input.hideAmount !== undefined) {
    values.hideAmount = input.hideAmount;
    set.hideAmount = input.hideAmount;
  }
  if (input.stayAnonymous !== undefined) {
    values.stayAnonymous = input.stayAnonymous;
    set.stayAnonymous = input.stayAnonymous;
  }
  if (input.imageUrl !== undefined) {
    values.imageUrl = input.imageUrl;
    set.imageUrl = input.imageUrl;
  }
  if (input.processingFee !== undefined) {
    values.processingFee = input.processingFee;
    set.processingFee = input.processingFee;
  }
  if (input.status !== undefined) {
    values.status = input.status;
    set.status = input.status;
  }

  const [row] = await db
    .insert(giftsMetadata)
    .values(values as typeof giftsMetadata.$inferInsert)
    .onConflictDoUpdate({
      target: giftsMetadata.contractGiftId,
      set,
    })
    .returning();

  return toRecord(row);
}
