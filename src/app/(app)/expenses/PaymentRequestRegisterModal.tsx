// src/app/(app)/expenses/PaymentRequestRegisterModal.tsx
"use client";

import { useState } from "react";
import type { PayeeOption } from "@/lib/data/payees";
import { PaymentRequestRowsTable, newDraftRow, type DraftRow } from "./PaymentRequestRowsTable";

// 정산담당자/관리자용 등록 팝업. PM 전용 페이지(PaymentRequestNewForm)와 같은 행 편집기를
// 공유하되, 엑셀 업로드(예외건) 경로는 PM 전용이라 여기엔 없다. 저장은 다음 단계에서 연결.
export function PaymentRequestRegisterModal({
  clients,
  payees,
  onClose,
}: {
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([newDraftRow()]);

  function handleSave() {
    alert("추후 구현 예정입니다.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">지급요청 등록</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>

        <PaymentRequestRowsTable rows={rows} onRowsChange={setRows} clients={clients} payees={payees} />

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
          <button type="button" onClick={handleSave} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">저장</button>
        </div>
      </div>
    </div>
  );
}
