"use client";

import { useState, useTransition } from "react";
import { bulkUpdatePaymentRequestsAction } from "./payment-request/actions";

// 체크박스로 선택한 여러 건에 같은 지급일/지급여부를 한 번에 적용하는 팝업.
export function PaymentRequestBulkUpdateModal({
  ids,
  onClose,
  onSuccess,
}: {
  ids: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [payDate, setPayDate] = useState("");
  const [status, setStatus] = useState<"PREPARING" | "COMPLETED">("COMPLETED");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleApply() {
    const formData = new FormData();
    formData.set("payDate", payDate);
    formData.set("status", status);

    setError(null);
    startTransition(async () => {
      const result = await bulkUpdatePaymentRequestsAction(ids, formData);
      if (result.ok) {
        onSuccess();
      } else {
        setError(result.error ?? "수정 중 오류가 발생했습니다.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={pending ? undefined : onClose}>
      <div className="w-full max-w-sm rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">수정</h2>
          <button type="button" onClick={onClose} disabled={pending} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">선택한 {ids.length}건에 동일한 지급일/지급여부를 적용합니다.</p>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          지급일
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 rounded border border-[var(--color-border)] px-2 py-2 text-sm" />
        </label>
        <label className="mt-3 flex flex-col text-xs text-[var(--color-muted)]">
          지급여부
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="mt-1 rounded border border-[var(--color-border)] px-2 py-2 text-sm">
            <option value="PREPARING">지급준비</option>
            <option value="COMPLETED">지급완료</option>
          </select>
        </label>
        {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-60">취소</button>
          <button type="button" onClick={handleApply} disabled={pending} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
            {pending ? "적용 중..." : "적용"}
          </button>
        </div>
      </div>
    </div>
  );
}
