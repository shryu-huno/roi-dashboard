"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileDropzone } from "@/components/FileDropzone";
import { uploadPaymentRequestUpdatesAction } from "./payment-request/actions";
import { PAYMENT_REQUEST_UPLOAD_INIT } from "./payment-request/upload-state";

// 정산담당자/관리자가 등록된 지급요청을 엑셀로 다운로드해 지급일/지급여부만 채운 뒤
// 재업로드하는 팝업. No로 매칭된 건의 지급일/지급여부만 반영되고 나머지 컬럼은 무시된다.
export function PaymentRequestExcelUploadModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(uploadPaymentRequestUpdatesAction, PAYMENT_REQUEST_UPLOAD_INIT);

  // 반영이 1건이라도 생기면 목록 갱신, 오류 없이 성공하면 모달 닫기.
  useEffect(() => {
    if (state.updated && state.updated > 0) router.refresh();
    if (state.ok && state.updated && state.updated > 0 && !(state.rowErrors && state.rowErrors.length)) {
      onClose();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">⬆ 엑셀 업로드</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          다운로드한 엑셀에 지급일/지급여부만 채워서 업로드하면 해당 값만 반영됩니다.
        </p>

        <form action={formAction}>
          <FileDropzone name="file" accept=".xlsx" hint="지원 확장자: .xlsx" />

          <p className="mt-3 rounded bg-[var(--color-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
            반영 항목: 지급일, 지급여부
          </p>

          {state.ok && state.message && (
            <p className="mt-3 text-sm text-[var(--color-primary)]">{state.message}</p>
          )}
          {!state.ok && state.error && (
            <p className="mt-3 text-sm text-[var(--color-danger)]">{state.error}</p>
          )}
          {state.rowErrors && state.rowErrors.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto rounded border border-[var(--color-border)] px-5 py-2 text-xs text-[var(--color-danger)]">
              {state.rowErrors.map((e, i) => (
                <li key={i}>{e.row ? `${e.row}행: ` : ""}{e.message}</li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
            <button type="submit" disabled={pending} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
              {pending ? "업로드 중..." : "⬆ 업로드 실행"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
