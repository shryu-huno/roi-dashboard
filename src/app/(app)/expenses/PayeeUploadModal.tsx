"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileDropzone } from "@/components/FileDropzone";
import { uploadPayeesAction } from "./payees/actions";
import { PAYEE_UPLOAD_INIT } from "./payees/upload-state";

export function PayeeUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(uploadPayeesAction, PAYEE_UPLOAD_INIT);

  // 등록이 1건이라도 생기면 목록 갱신, 오류 없이 성공하면 모달 닫기.
  useEffect(() => {
    if (state.created && state.created > 0) router.refresh();
    if (state.ok && state.created && state.created > 0 && !(state.rowErrors && state.rowErrors.length)) {
      onClose();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">📗 지출 입력 - 지급 리스트 등록</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          강사 및 업체 지급 정보를 엑셀 양식에 맞춰 일괄 업로드합니다.
        </p>

        <form action={formAction}>
          <FileDropzone name="file" accept=".xlsx,.xls,.csv" hint="지원 확장자: .xlsx, .xls, .csv" />

          <p className="mt-3 rounded bg-[var(--color-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
            업로드 항목: 사업자명(이름), 사업자번호, 연락처, 은행명, 계좌번호, 예금주, 청구방식
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

          <div className="mt-5 flex items-center justify-between">
            <a
              href="/expenses/payees/template"
              className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
            >
              ⬇ 엑셀 서식 다운로드
            </a>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60"
            >
              {pending ? "업로드 중..." : "⬆ 업로드 실행"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
