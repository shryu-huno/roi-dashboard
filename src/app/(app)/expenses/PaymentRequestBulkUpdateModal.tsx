"use client";

import { useState } from "react";

// 체크박스로 선택한 여러 건에 같은 지급일/지급여부를 한 번에 적용하는 팝업.
// 실제 일괄 반영 로직은 다음 단계에서 서버 액션을 연결한다 — 이번 단계는 화면만.
export function PaymentRequestBulkUpdateModal({ count, onClose }: { count: number; onClose: () => void }) {
  const [payDate, setPayDate] = useState("");
  const [status, setStatus] = useState<"PREPARING" | "COMPLETED">("COMPLETED");

  function handleApply() {
    alert("추후 구현 예정입니다.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">일괄수정</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">선택한 {count}건에 동일한 지급일/지급여부를 적용합니다.</p>
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
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
          <button type="button" onClick={handleApply} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">적용</button>
        </div>
      </div>
    </div>
  );
}
