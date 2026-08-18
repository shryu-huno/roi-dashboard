"use server";

import type { PayeeFileType } from "@prisma/client";
import { requireRole, requireAllAccess } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { revalidatePath } from "next/cache";
import { getPayeeAttachments } from "@/lib/data/payee-attachments";
import { saveAttachmentsCore, getDownloadUrlCore } from "./attachment-core";
import type { PayeeAttachmentSaveState } from "./attachment-state";

export async function getPayeeAttachmentsAction(payeeId: string): Promise<{
  bizCert: { fileName: string } | null;
  bankbook: { fileName: string } | null;
}> {
  const user = await requireRole("PM"); // ADMIN/SETTLEMENT도 랭크상 통과. 파일명만 반환하므로 PM도 열람 가능.
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
  const user = await requireRole("PM"); // ADMIN/SETTLEMENT도 랭크상 통과.
  // PM은 업로드/교체만 가능하고 삭제는 불가 — 클라이언트가 hidden input을 조작해도 서버에서 무력화한다.
  if (user.role === "PM") {
    formData.delete("bizCertDelete");
    formData.delete("bankbookDelete");
  }
  const ctx = getRlsContext(user);
  const result = await saveAttachmentsCore(ctx, formData);
  revalidatePath("/expenses");
  return result;
}

export async function getAttachmentDownloadUrlAction(
  payeeId: string,
  fileType: PayeeFileType,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireAllAccess(); // 다운로드는 최고관리자·정산담당자만(통장사본/사업자등록증 원문 노출). PM·팀 관리자 차단.
  const ctx = getRlsContext(user);
  return getDownloadUrlCore(ctx, payeeId, fileType);
}
