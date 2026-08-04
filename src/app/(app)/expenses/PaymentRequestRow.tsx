"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentRequestRow as PaymentRequestRowData } from "@/lib/data/payment-requests";
import type { PayeeOption } from "@/lib/data/payees";
import { PayeeCombobox } from "@/components/PayeeCombobox";
import { PaymentRequestClientCombobox } from "@/components/PaymentRequestClientCombobox";
import {
  PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL,
  paymentRequestEntityLabel, paymentRequestStatusLabel,
} from "@/lib/labels";
import { formatWon } from "@/lib/format";
import { updatePaymentRequestAction } from "./payment-request/actions";

const inputCls =
  "w-full rounded border-2 border-[var(--color-primary)]/50 bg-[var(--color-surface)] px-2 py-1.5 text-center text-sm shadow-sm focus:border-[var(--color-primary)] focus:outline-none";
const cellCls = "whitespace-nowrap px-3 py-2 text-center align-middle";

function dateStr(d: Date | null): string {
  return d ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : "-";
}

// 정산담당자/관리자 전용 인라인 편집 행. 지급명의/고객사/사업자명/지급일/지급여부를
// 한 번에 편집하고 저장한다(PayeeRow.tsx와 동일한 ref 기반 편집 패턴).
export function PaymentRequestRow({
  row,
  isEditing,
  isSelected,
  clients,
  payees,
  onToggleSelect,
  onStartEdit,
  onStopEdit,
  onRequestDelete,
}: {
  row: PaymentRequestRowData;
  isEditing: boolean;
  isSelected: boolean;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onRequestDelete: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const entityRef = useRef<HTMLSelectElement>(null);
  const payDateRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const [clientId, setClientId] = useState(row.clientId);
  const [payeeId, setPayeeId] = useState<string | null>(row.payeeId);

  function handleCancel() {
    setError(null);
    setClientId(row.clientId);
    setPayeeId(row.payeeId);
    onStopEdit();
  }

  function handleSave() {
    if (!payeeId) {
      setError("사업자명을 선택하세요.");
      return;
    }
    const formData = new FormData();
    formData.set("entity", entityRef.current!.value);
    formData.set("clientId", clientId);
    formData.set("payeeId", payeeId);
    formData.set("payDate", payDateRef.current!.value);
    formData.set("status", statusRef.current!.value);

    setError(null);
    startTransition(async () => {
      const result = await updatePaymentRequestAction(row.id, formData);
      if (result.ok) {
        router.refresh();
        onStopEdit();
      } else {
        setError(result.error ?? "수정 중 오류가 발생했습니다.");
      }
    });
  }

  return (
    <tr className={`border-b border-[var(--color-border)] ${isEditing || isSelected ? "bg-[var(--color-hover)]" : ""}`}>
      <td className={cellCls}>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect} aria-label={`${row.bizName} 선택`} />
      </td>
      <td className={cellCls}>{row.seqNo}</td>
      <td className={cellCls}>{dateStr(row.requestedAt)}</td>
      <td className={cellCls}>{row.requesterName}</td>
      <td className={cellCls}>
        {isEditing ? (
          <select ref={entityRef} className={inputCls} defaultValue={row.entity}>
            {PAYMENT_REQUEST_ENTITY_LABELS.map((label) => (
              <option key={label} value={PAYMENT_REQUEST_ENTITY_BY_LABEL[label]}>{label}</option>
            ))}
          </select>
        ) : (
          paymentRequestEntityLabel(row.entity)
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <PaymentRequestClientCombobox clients={clients} selectedId={clientId} onSelect={(c) => setClientId(c?.id ?? "")} />
        ) : (
          row.clientName
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <PayeeCombobox payees={payees} selectedId={payeeId} onSelect={(p) => setPayeeId(p?.id ?? null)} />
        ) : (
          row.bizName
        )}
      </td>
      <td className={cellCls}>{formatWon(row.amount)}</td>
      <td className={cellCls}>
        {isEditing ? (
          <input
            ref={payDateRef}
            type="date"
            defaultValue={row.payDate ? row.payDate.toISOString().slice(0, 10) : ""}
            className={inputCls}
          />
        ) : (
          dateStr(row.payDate)
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <select ref={statusRef} className={inputCls} defaultValue={row.status}>
            <option value="PREPARING">지급준비</option>
            <option value="COMPLETED">지급완료</option>
          </select>
        ) : (
          paymentRequestStatusLabel(row.status)
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <div className="flex flex-col items-center gap-1">
            <div className="flex justify-center gap-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={pending}
                className="whitespace-nowrap rounded bg-[var(--color-success)] px-3 py-1.5 text-xs text-white disabled:opacity-60"
              >
                {pending ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={pending}
                className="whitespace-nowrap rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
              >
                취소
              </button>
            </div>
            {error && <p className="whitespace-normal text-xs text-[var(--color-danger)]">{error}</p>}
          </div>
        ) : (
          <div className="flex justify-center gap-2">
            <button type="button" onClick={onStartEdit} className="text-[var(--color-muted)] hover:text-[var(--color-primary)]" aria-label="편집">✏️</button>
            <button type="button" onClick={onRequestDelete} className="text-[var(--color-muted)] hover:text-[var(--color-danger)]" aria-label="삭제">🗑️</button>
          </div>
        )}
      </td>
    </tr>
  );
}
