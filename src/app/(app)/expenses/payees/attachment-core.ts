import type { PayeeFileType } from "@prisma/client";
import type { RlsContext } from "@/lib/rls";
import { getPayeeAttachments, upsertPayeeAttachment, deletePayeeAttachment } from "@/lib/data/payee-attachments";
import {
  validateAttachmentFile, attachmentPath, uploadPayeeFile, deletePayeeFile, signedDownloadUrl, StorageConfigError,
} from "@/lib/storage/payee-attachments";
import type { PayeeAttachmentSaveState } from "./attachment-state";

// 슬롯 하나(BIZ_CERT 또는 BANKBOOK) 처리. 성공/변경없음이면 undefined, 실패면 에러 메시지.
async function processSlot(
  ctx: RlsContext,
  payeeId: string,
  fileType: PayeeFileType,
  fileField: FormDataEntryValue | null,
  shouldDelete: boolean,
): Promise<string | undefined> {
  const pair = await getPayeeAttachments(ctx, payeeId);
  const existing = fileType === "BIZ_CERT" ? pair.bizCert : pair.bankbook;

  if (shouldDelete) {
    if (!existing) return undefined;
    await deletePayeeFile(existing.fileUrl);
    await deletePayeeAttachment(ctx, payeeId, fileType);
    return undefined;
  }

  if (!(fileField instanceof File) || fileField.size === 0) return undefined; // 변경 없음

  const validationError = validateAttachmentFile(fileField);
  if (validationError) return validationError;

  const path = attachmentPath(payeeId, fileType, fileField.name);
  await uploadPayeeFile(path, fileField); // 업로드 먼저
  await upsertPayeeAttachment(ctx, payeeId, fileType, { fileUrl: path, fileName: fileField.name });
  if (existing) {
    try {
      await deletePayeeFile(existing.fileUrl); // 성공 후 이전 파일 정리
    } catch (e) {
      console.error("[attachment save] 이전 파일 정리 실패 (교체는 완료됨):", existing.fileUrl, e);
    }
  }
  return undefined;
}

export async function saveAttachmentsCore(ctx: RlsContext, formData: FormData): Promise<PayeeAttachmentSaveState> {
  const payeeId = String(formData.get("payeeId") ?? "");
  if (!payeeId) return { ok: false, error: "잘못된 요청입니다." };

  let bizCertError: string | undefined;
  let bankbookError: string | undefined;

  try {
    bizCertError = await processSlot(ctx, payeeId, "BIZ_CERT", formData.get("bizCertFile"), formData.get("bizCertDelete") === "true");
  } catch (e) {
    // Storage 환경변수 누락은 파일 문제가 아니라 서버 설정 문제다. 관리자가 멀쩡한 파일을
    // 계속 다시 올리게 하지 않도록 구분해서 안내한다(payee-secret.ts의 PayeeKeyConfigError와 동일한 이유).
    if (e instanceof StorageConfigError) {
      console.error("[attachment save] Storage 설정 오류:", e.message);
      return { ok: false, error: "서버 설정(파일 저장소)이 누락되었습니다. 관리자에게 문의하세요." };
    }
    console.error("[attachment save] 사업자등록증 처리 실패:", e);
    bizCertError = "사업자등록증 처리 중 오류가 발생했습니다.";
  }

  try {
    bankbookError = await processSlot(ctx, payeeId, "BANKBOOK", formData.get("bankbookFile"), formData.get("bankbookDelete") === "true");
  } catch (e) {
    if (e instanceof StorageConfigError) {
      console.error("[attachment save] Storage 설정 오류:", e.message);
      return { ok: false, error: "서버 설정(파일 저장소)이 누락되었습니다. 관리자에게 문의하세요." };
    }
    console.error("[attachment save] 통장사본 처리 실패:", e);
    bankbookError = "통장사본 처리 중 오류가 발생했습니다.";
  }

  if (bizCertError || bankbookError) {
    return { ok: false, error: "일부 항목 저장에 실패했습니다.", bizCertError, bankbookError };
  }
  return { ok: true, message: "저장되었습니다." };
}

export async function getDownloadUrlCore(
  ctx: RlsContext,
  payeeId: string,
  fileType: PayeeFileType,
  downloadFileName?: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const pair = await getPayeeAttachments(ctx, payeeId);
  const record = fileType === "BIZ_CERT" ? pair.bizCert : pair.bankbook;
  if (!record) return { ok: false, error: "파일을 찾을 수 없습니다." };

  try {
    const url = await signedDownloadUrl(record.fileUrl, downloadFileName);
    return { ok: true, url };
  } catch (e) {
    if (e instanceof StorageConfigError) {
      console.error("[attachment download] Storage 설정 오류:", e.message);
      return { ok: false, error: "서버 설정(파일 저장소)이 누락되었습니다. 관리자에게 문의하세요." };
    }
    console.error("[attachment download] URL 발급 실패:", e);
    return { ok: false, error: "다운로드 URL 발급에 실패했습니다." };
  }
}
