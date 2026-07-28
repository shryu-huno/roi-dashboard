"use server";

import type { PayeeFileType } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { revalidatePath } from "next/cache";
import { getPayeeAttachments } from "@/lib/data/payee-attachments";
import { saveAttachmentsCore, getDownloadUrlCore } from "./attachment-core";
import type { PayeeAttachmentSaveState } from "./attachment-state";

export async function getPayeeAttachmentsAction(payeeId: string): Promise<{
  bizCert: { fileName: string } | null;
  bankbook: { fileName: string } | null;
}> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const pair = await getPayeeAttachments(ctx, payeeId);
  return {
    bizCert: pair.bizCert ? { fileName: pair.bizCert.fileName } : null,
    bankbook: pair.bankbook ? { fileName: pair.bankbook.fileName } : null,
  };
}

export async function saveAttachmentsAction(
  _prev: PayeeAttachmentSaveState,
  formData: FormData,
): Promise<PayeeAttachmentSaveState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const result = await saveAttachmentsCore(ctx, formData);
  revalidatePath("/expenses");
  return result;
}

export async function getAttachmentDownloadUrlAction(
  payeeId: string,
  fileType: PayeeFileType,
  downloadFileName?: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  return getDownloadUrlCore(ctx, payeeId, fileType, downloadFileName);
}
