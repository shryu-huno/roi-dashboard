// src/app/(app)/expenses/PaymentRequestDetailModal.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentRequestRow } from "@/lib/data/payment-requests";
import type { PayeeOption } from "@/lib/data/payees";
import type { AppRole } from "@/lib/auth/rbac";
import { PayeeCombobox } from "@/components/PayeeCombobox";
import { PaymentRequestClientCombobox } from "@/components/PaymentRequestClientCombobox";
import {
  PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL,
  taxTypeLabel, paymentRequestEntityLabel, paymentRequestStatusLabel,
} from "@/lib/labels";
import { formatThousands, formatWon } from "@/lib/format";
import { updatePaymentRequestPmAction } from "./payment-request/actions";

// PM 전용 상세/수정 모달. 지급완료 전 + 본인 신청 건에 한해 등록 시 작성한 항목
// 전체(지급명의/고객사/사업자명/단가/교통비/재료비/횟수/상세내역)를 수정할 수 있다.
// 지급일/지급여부는 정산담당자 전담이라 항상 읽기전용이다. 정산담당자/관리자는 이
// 모달을 쓰지 않는다(목록 화면 인라인 편집으로 대체 — PaymentRequestRow.tsx).
export function PaymentRequestDetailModal({
  row,
  role,
  currentUserId,
  clients,
  payees,
  onClose,
}: {
  row: PaymentRequestRow;
  role: AppRole;
  currentUserId: string;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const canEditPmFields = role === "PM" && row.status === "PREPARING" && row.requesterId === currentUserId;

  const [entity, setEntity] = useState(row.entity);
  const [clientId, setClientId] = useState(row.clientId);
  const [payeeId, setPayeeId] = useState<string | null>(row.payeeId);
  const [taxType, setTaxType] = useState(row.taxType);
  const [unitPrice, setUnitPrice] = useState(String(row.unitPrice));
  const [transportFee, setTransportFee] = useState(String(row.transportFee));
  const [materialFee, setMaterialFee] = useState(String(row.materialFee));
  const [count, setCount] = useState(String(row.count));
  const [memo, setMemo] = useState(row.memo);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const previewTotal = ((Number(unitPrice) || 0) + (Number(transportFee) || 0) + (Number(materialFee) || 0)) * (Number(count) || 0);

  function handleSave() {
    if (!payeeId) {
      setError("사업자명을 선택하세요.");
      return;
    }
    const formData = new FormData();
    formData.set("entity", entity);
    formData.set("clientId", clientId);
    formData.set("payeeId", payeeId);
    formData.set("unitPrice", unitPrice);
    formData.set("transportFee", transportFee);
    formData.set("materialFee", materialFee);
    formData.set("count", count);
    formData.set("memo", memo);

    setError(null);
    startTransition(async () => {
      const result = await updatePaymentRequestPmAction(row.id, formData);
      if (result.ok) {
        router.refresh();
        onClose();
      } else {
        setError(result.error ?? "수정 중 오류가 발생했습니다.");
      }
    });
  }

  const fieldCls = "flex flex-col text-xs text-[var(--color-muted)]";
  const valueCls = "mt-1 text-sm text-[var(--color-fg)]";
  const inputCls = "mt-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-center text-sm";

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

          <label className={fieldCls}>
            지급명의
            {canEditPmFields ? (
              <select value={entity} onChange={(e) => setEntity(e.target.value as typeof entity)} className={inputCls}>
                {PAYMENT_REQUEST_ENTITY_LABELS.map((label) => (
                  <option key={label} value={PAYMENT_REQUEST_ENTITY_BY_LABEL[label]}>{label}</option>
                ))}
              </select>
            ) : (
              <span className={valueCls}>{paymentRequestEntityLabel(row.entity)}</span>
            )}
          </label>

          <label className={fieldCls}>
            고객사
            {canEditPmFields ? (
              <PaymentRequestClientCombobox clients={clients} selectedId={clientId} onSelect={(c) => setClientId(c?.id ?? "")} />
            ) : (
              <span className={valueCls}>{row.clientName}</span>
            )}
          </label>

          <label className={fieldCls}>
            사업자명(이름)
            {canEditPmFields ? (
              <PayeeCombobox
                payees={payees}
                selectedId={payeeId}
                onSelect={(p) => { setPayeeId(p?.id ?? null); setTaxType(p?.taxType ?? row.taxType); }}
              />
            ) : (
              <span className={valueCls}>{row.bizName}</span>
            )}
          </label>

          <div className={fieldCls}>청구방식<span className={valueCls}>{taxTypeLabel(canEditPmFields ? taxType : row.taxType)}</span></div>

          <label className={fieldCls}>
            단가
            {canEditPmFields ? (
              <input type="text" inputMode="numeric" value={formatThousands(unitPrice)} onChange={(e) => setUnitPrice(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
            ) : (
              <span className={valueCls}>{formatWon(row.unitPrice)}</span>
            )}
          </label>
          <label className={fieldCls}>
            교통비
            {canEditPmFields ? (
              <input type="text" inputMode="numeric" value={formatThousands(transportFee)} onChange={(e) => setTransportFee(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
            ) : (
              <span className={valueCls}>{formatWon(row.transportFee)}</span>
            )}
          </label>
          <label className={fieldCls}>
            재료비
            {canEditPmFields ? (
              <input type="text" inputMode="numeric" value={formatThousands(materialFee)} onChange={(e) => setMaterialFee(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
            ) : (
              <span className={valueCls}>{formatWon(row.materialFee)}</span>
            )}
          </label>
          <label className={fieldCls}>
            횟수
            {canEditPmFields ? (
              <input type="text" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
            ) : (
              <span className={valueCls}>{row.count}</span>
            )}
          </label>

          <div className={fieldCls}>지급액<span className={valueCls}>{formatWon(canEditPmFields ? previewTotal : row.amount)}</span></div>

          <label className="col-span-2 flex flex-col text-xs text-[var(--color-muted)]">
            상세내역(비고)
            {canEditPmFields ? (
              <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} className={inputCls} />
            ) : (
              <span className={valueCls}>{row.memo}</span>
            )}
          </label>

          <div className={fieldCls}>지급일<span className={valueCls}>{row.payDate ? row.payDate.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : "-"}</span></div>
          <div className={fieldCls}>지급여부<span className={valueCls}>{paymentRequestStatusLabel(row.status)}</span></div>
        </div>

        {!canEditPmFields && (
          <p className="mt-4 text-xs text-[var(--color-muted)]">지급완료된 건이거나 수정 권한이 없어 읽기전용으로 표시됩니다.</p>
        )}
        {error && <p className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">닫기</button>
          {canEditPmFields && (
            <button type="button" onClick={handleSave} disabled={pending} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
              {pending ? "저장 중..." : "저장"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
