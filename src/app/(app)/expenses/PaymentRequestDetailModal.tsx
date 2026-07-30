// src/app/(app)/expenses/PaymentRequestDetailModal.tsx
"use client";

import { useState } from "react";
import type { PaymentRequestRow } from "@/lib/data/payment-requests";
import type { AppRole } from "@/lib/auth/rbac";
import { taxTypeLabel, paymentRequestEntityLabel, paymentRequestStatusLabel } from "@/lib/labels";
import { formatWon } from "@/lib/format";

// PM은 지급완료 전 + 본인 신청 건에 한해 지급명의~상세내역을 수정할 수 있고,
// 정산담당자/관리자는 지급일/지급여부만 수정할 수 있다(그 외는 읽기전용).
// 실제 저장은 다음 단계에서 서버 액션을 연결한다 — 이번 단계는 화면만.
export function PaymentRequestDetailModal({
  row,
  role,
  currentUserId,
  onClose,
}: {
  row: PaymentRequestRow;
  role: AppRole;
  currentUserId: string;
  onClose: () => void;
}) {
  const canEditPmFields = role === "PM" && row.status === "PREPARING" && row.requesterId === currentUserId;
  const canEditSettlementFields = role === "ADMIN" || role === "SETTLEMENT";

  const [payDate, setPayDate] = useState(row.payDate ? row.payDate.toISOString().slice(0, 10) : "");
  const [status, setStatus] = useState(row.status);

  function handleSave() {
    alert("추후 구현 예정입니다.");
  }

  const fieldCls = "flex flex-col text-xs text-[var(--color-muted)]";
  const valueCls = "mt-1 text-sm text-[var(--color-fg)]";
  const inputCls = "mt-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">지급요청 상세</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className={fieldCls}>신청일<span className={valueCls}>{row.requestedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })}</span></div>
          <div className={fieldCls}>신청인<span className={valueCls}>{row.requesterName}</span></div>
          <div className={fieldCls}>지급명의<span className={valueCls}>{paymentRequestEntityLabel(row.entity)}</span></div>
          <div className={fieldCls}>고객사<span className={valueCls}>{row.clientName}</span></div>
          <div className={fieldCls}>사업자명(이름)<span className={valueCls}>{row.bizName}</span></div>
          <div className={fieldCls}>청구방식<span className={valueCls}>{taxTypeLabel(row.taxType)}</span></div>
          <div className={fieldCls}>단가<span className={valueCls}>{formatWon(row.unitPrice)}</span></div>
          <div className={fieldCls}>교통비<span className={valueCls}>{formatWon(row.transportFee)}</span></div>
          <div className={fieldCls}>재료비<span className={valueCls}>{formatWon(row.materialFee)}</span></div>
          <div className={fieldCls}>횟수<span className={valueCls}>{row.count}</span></div>
          <div className={fieldCls}>지급액<span className={valueCls}>{formatWon(row.amount)}</span></div>
          <div className="col-span-2 flex flex-col text-xs text-[var(--color-muted)]">상세내역(비고)<span className={valueCls}>{row.memo}</span></div>

          <label className={fieldCls}>
            지급일
            {canEditSettlementFields ? (
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputCls} />
            ) : (
              <span className={valueCls}>{row.payDate ? row.payDate.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : "-"}</span>
            )}
          </label>
          <label className={fieldCls}>
            지급여부
            {canEditSettlementFields ? (
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputCls}>
                <option value="PREPARING">지급준비</option>
                <option value="COMPLETED">지급완료</option>
              </select>
            ) : (
              <span className={valueCls}>{paymentRequestStatusLabel(row.status)}</span>
            )}
          </label>
        </div>

        {!canEditPmFields && !canEditSettlementFields && (
          <p className="mt-4 text-xs text-[var(--color-muted)]">지급완료된 건이거나 수정 권한이 없어 읽기전용으로 표시됩니다.</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">닫기</button>
          {(canEditPmFields || canEditSettlementFields) && (
            <button type="button" onClick={handleSave} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">저장</button>
          )}
        </div>
      </div>
    </div>
  );
}
