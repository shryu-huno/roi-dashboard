"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileDropzone } from "@/components/FileDropzone";
import { uploadPaymentRequestCreatesAction } from "./payment-request/actions";
import { PAYMENT_REQUEST_CREATE_UPLOAD_INIT } from "./payment-request/create-upload-state";

// PM 등록 화면 전용 엑셀 대량 등록 모달. 정산담당자의 지급일/지급여부 재업로드용
// PaymentRequestExcelUploadModal과는 별개 기능/파일이다.
export function PaymentRequestExcelRegisterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(uploadPaymentRequestCreatesAction, PAYMENT_REQUEST_CREATE_UPLOAD_INIT);

  // 등록이 1건이라도 성공하면 목록을 갱신한다. 모달은 닫지 않고 성공 메시지를
  // 사용자가 직접 확인 후 헤더의 ✕ 버튼으로 닫도록 둔다(성공 메시지가 한 프레임만
  // 보이고 사라지는 문제 방지).
  useEffect(() => {
    if (state.ok && state.created && state.created > 0) {
      router.refresh();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">📗 지급요청 엑셀 등록</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          지급요청 정보를 엑셀 양식에 맞춰 일괄 등록합니다. 한 행이라도 오류가 있으면 전체가 저장되지 않습니다.
        </p>

        <form action={formAction}>
          <FileDropzone name="file" accept=".xlsx" hint="지원 확장자: .xlsx" />

          <p className="mt-3 rounded bg-[var(--color-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
            업로드 항목: 지급명의, 고객사명, 사업자명(이름), 고유번호, 연락처, 사업자번호(주민등록번호), 은행명, 계좌번호, 예금주, 단가, 교통비, 재료비, 횟수, 청구방식, 상세내역
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
              href="/expenses/payment-request/registration-template"
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
