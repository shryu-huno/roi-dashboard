"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PayeeFileType } from "@prisma/client";
import { FileDropzone } from "@/components/FileDropzone";
import {
  getPayeeAttachmentsAction, saveAttachmentsAction, getAttachmentDownloadUrlAction,
} from "./payees/attachment-actions";
import { PAYEE_ATTACHMENT_SAVE_INIT } from "./payees/attachment-state";

type SlotState = { fileName: string } | null;

export function PayeeAttachmentModal({
  open, payeeId, keyId, bizName, onClose,
}: {
  open: boolean;
  payeeId: string;
  keyId: string;
  bizName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveAttachmentsAction, PAYEE_ATTACHMENT_SAVE_INIT);
  const [loading, setLoading] = useState(true);
  const [bizCert, setBizCert] = useState<SlotState>(null);
  const [bankbook, setBankbook] = useState<SlotState>(null);
  const [bizCertDelete, setBizCertDelete] = useState(false);
  const [bankbookDelete, setBankbookDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getPayeeAttachmentsAction(payeeId).then((res) => {
      setBizCert(res.bizCert);
      setBankbook(res.bankbook);
      setLoading(false);
    });
  }, [open, payeeId]);

  useEffect(() => {
    if (state.ok && state.message) {
      router.refresh();
      onClose();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDownload(fileType: PayeeFileType) {
    const res = await getAttachmentDownloadUrlAction(payeeId, fileType);
    if (res.ok) window.open(res.url, "_blank");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">첨부파일 관리</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          고유번호 바인딩<br />
          고유번호: {keyId} [업체/강사명: {bizName}]
        </p>

        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--color-muted)]">불러오는 중...</p>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="payeeId" value={payeeId} />

            <AttachmentSlot
              label="사업자등록증(신분증 사본)"
              existing={bizCert}
              fieldName="bizCertFile"
              markedForDelete={bizCertDelete}
              onMarkDelete={setBizCertDelete}
              onDownload={() => handleDownload("BIZ_CERT")}
              errorMessage={state.bizCertError}
            />
            {bizCertDelete && <input type="hidden" name="bizCertDelete" value="true" />}

            <div className="my-4 border-t border-[var(--color-border)]" />

            <AttachmentSlot
              label="통장사본"
              existing={bankbook}
              fieldName="bankbookFile"
              markedForDelete={bankbookDelete}
              onMarkDelete={setBankbookDelete}
              onDownload={() => handleDownload("BANKBOOK")}
              errorMessage={state.bankbookError}
            />
            {bankbookDelete && <input type="hidden" name="bankbookDelete" value="true" />}

            {!state.ok && state.error && (
              <p className="mt-4 text-sm text-[var(--color-danger)]">{state.error}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
                닫기
              </button>
              <button type="submit" disabled={pending} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
                {pending ? "저장 중..." : "저장 완료"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function AttachmentSlot({
  label, existing, fieldName, markedForDelete, onMarkDelete, onDownload, errorMessage,
}: {
  label: string;
  existing: SlotState;
  fieldName: string;
  markedForDelete: boolean;
  onMarkDelete: (v: boolean) => void;
  onDownload: () => void;
  errorMessage?: string;
}) {
  const [replacing, setReplacing] = useState(false);

  if (markedForDelete) {
    return (
      <div>
        <p className="mb-2 text-sm font-medium">{label}</p>
        <p className="rounded bg-[var(--color-hover)] px-3 py-2 text-sm text-[var(--color-muted)]">
          삭제 예정: {existing?.fileName}
          <button type="button" onClick={() => onMarkDelete(false)} className="ml-3 text-[var(--color-primary)] hover:underline">
            취소
          </button>
        </p>
      </div>
    );
  }

  if (existing && !replacing) {
    return (
      <div>
        <p className="mb-2 text-sm font-medium">{label}</p>
        <div className="flex items-center justify-between rounded border border-[var(--color-border)] px-3 py-2">
          <span className="truncate text-sm">{existing.fileName}</span>
          <div className="flex shrink-0 gap-2 text-sm">
            <button type="button" onClick={onDownload} className="text-[var(--color-primary)] hover:underline">다운로드</button>
            <button type="button" onClick={() => setReplacing(true)} className="text-[var(--color-primary)] hover:underline">교체</button>
            <button type="button" onClick={() => onMarkDelete(true)} className="text-[var(--color-danger)] hover:underline">삭제</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <FileDropzone name={fieldName} accept=".pdf,.jpg,.jpeg,.png" label="파일을 이곳에 드래그 앤 드롭 하세요" hint="PDF, JPG, PNG · 10MB 이하" />
      {errorMessage && <p className="mt-1 text-xs text-[var(--color-danger)]">{errorMessage}</p>}
    </div>
  );
}
