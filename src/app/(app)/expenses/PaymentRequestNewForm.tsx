"use client";

import { useState } from "react";
import Link from "next/link";
import type { PayeeOption } from "@/lib/data/payees";
import { PaymentRequestRowsTable, newDraftRow, type DraftRow } from "./PaymentRequestRowsTable";

// PM 전용 지급요청 등록 화면. 행 추가/삭제·자동계산·엑셀 업로드 버튼은 이번 단계에서 완성하되,
// 실제 저장(서버 액션)은 다음 단계에서 연결한다 — "저장" 클릭은 안내만 띄운다.
export function PaymentRequestNewForm({
  clients,
  payees,
}: {
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
}) {
  const [rows, setRows] = useState<DraftRow[]>([newDraftRow()]);

  function handleSave() {
    alert("추후 구현 예정입니다.");
  }

  function handleExcelUpload() {
    alert("추후 구현 예정입니다.");
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">지급요청 등록</h1>
        <div className="flex gap-2">
          <button type="button" onClick={handleExcelUpload} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            엑셀 업로드(예외건)
          </button>
          <Link href="/expenses?tab=payment-request" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            취소
          </Link>
          <button type="button" onClick={handleSave} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">
            저장
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-[var(--color-muted)]">
        지급 리스트에 등록된 대상은 사업자명(이름)에서 검색해 선택하세요. 지급 리스트에 없는 예외 건은
        &quot;엑셀 업로드(예외건)&quot;로 등록합니다.
      </p>

      <PaymentRequestRowsTable rows={rows} onRowsChange={setRows} clients={clients} payees={payees} />
    </div>
  );
}
