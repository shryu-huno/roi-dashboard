"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceRow as InvoiceRowData } from "@/lib/data/invoices";
import { PaymentRequestClientCombobox } from "@/components/PaymentRequestClientCombobox";
import { formatThousands, formatWon, digitsOnly } from "@/lib/format";
import { updateInvoiceAction, deleteInvoiceAction } from "./actions";
import { PaymentConfirmModal } from "./PaymentConfirmModal";

const ymd = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export function InvoiceRow({
  row,
  clients,
  isEditing,
  onStartEdit,
  onStopEdit,
}: {
  row: InvoiceRowData;
  clients: { id: string; name: string }[];
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPay, setShowPay] = useState(false);

  const [clientId, setClientId] = useState<string | null>(row.clientId);
  const [amount, setAmount] = useState(formatThousands(row.amount));
  const [issueDate, setIssueDate] = useState(ymd(row.issueDate));
  const [note, setNote] = useState(row.note ?? "");

  const paid = row.paidDate != null;
  const cellCls = "px-3 py-2 whitespace-nowrap align-top";
  const inputCls = "rounded border border-[var(--color-border)] px-2 py-1 text-sm";

  // 관리 버튼: 각각 녹색/연홍색/파란색 상자 + 흰 텍스트. 호버 시 상자는 흰색(테두리 유지), 텍스트는 상자색.
  const btnBase = "rounded border px-2 py-1 text-xs transition-colors disabled:opacity-60";
  const btnEdit = `${btnBase} border-[var(--color-success)] bg-[var(--color-success)] text-white hover:bg-white hover:text-[var(--color-success)]`;
  const btnDelete = `${btnBase} border-[var(--color-danger)] bg-[var(--color-danger)] text-white hover:bg-white hover:text-[var(--color-danger)]`;
  const btnPay = `${btnBase} border-[var(--color-primary)] bg-[var(--color-primary)] text-white hover:bg-white hover:text-[var(--color-primary)]`;

  function startEdit() {
    setClientId(row.clientId);
    setAmount(formatThousands(row.amount));
    setIssueDate(ymd(row.issueDate));
    setNote(row.note ?? "");
    setError(null);
    onStartEdit();
  }

  function handleSave() {
    if (!clientId) return setError("고객사를 선택하세요.");
    if (digitsOnly(amount) === "") return setError("청구금액을 입력하세요.");
    if (!issueDate) return setError("발행일자를 입력하세요.");
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("amount", amount);
    fd.set("issueDate", issueDate);
    fd.set("note", note);
    setError(null);
    startTransition(async () => {
      const res = await updateInvoiceAction(row.id, fd);
      if (res.ok) {
        router.refresh();
        onStopEdit();
      } else {
        setError(res.error ?? "수정 중 오류가 발생했습니다.");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`'${row.clientName}' 청구(${formatWon(row.amount)})를 삭제하시겠습니까?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteInvoiceAction(row.id);
      if (res.ok) router.refresh();
      else setError(res.error ?? "삭제 중 오류가 발생했습니다.");
    });
  }

  if (isEditing) {
    return (
      <tr className="border-b border-[var(--color-border)] bg-[var(--color-hover)]">
        <td className={cellCls}>
          <div className="w-44">
            <PaymentRequestClientCombobox clients={clients} selectedId={clientId} onSelect={(c) => setClientId(c?.id ?? null)} />
          </div>
        </td>
        <td className={cellCls}>{row.businessType ?? "—"}</td>
        <td className={cellCls}>{row.pmLabel}</td>
        <td className={`${cellCls} text-right`}>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(formatThousands(e.target.value))} className={`${inputCls} w-32 text-right`} />
        </td>
        <td className={cellCls}>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={`${inputCls} w-40`} />
        </td>
        <td className={cellCls}>{paid ? ymd(row.paidDate!) : "미입금"}</td>
        <td className={cellCls}>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} w-48`} />
        </td>
        <td className={cellCls}>
          <div className="flex flex-col items-start gap-1">
            <div className="flex gap-2">
              <button type="button" onClick={handleSave} disabled={pending} className="rounded bg-[var(--color-primary)] px-2 py-1 text-xs text-white disabled:opacity-60">
                {pending ? "저장 중..." : "저장"}
              </button>
              <button type="button" onClick={onStopEdit} disabled={pending} className="rounded border border-[var(--color-border)] px-2 py-1 text-xs">취소</button>
            </div>
            {error && <p className="whitespace-normal text-xs text-[var(--color-danger)]">{error}</p>}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className={`border-b border-[var(--color-border)] ${paid ? "bg-emerald-50" : ""}`}>
        <td className={cellCls}>{row.clientName}</td>
        <td className={cellCls}>{row.businessType ?? "—"}</td>
        <td className={cellCls}>{row.pmLabel}</td>
        <td className={`${cellCls} text-right`}>{formatWon(row.amount)}</td>
        <td className={cellCls}>{ymd(row.issueDate)}</td>
        <td className={cellCls}>
          {paid ? (
            <span className="inline-flex items-center gap-1">
              <span className="rounded bg-[var(--color-success)] px-1.5 py-0.5 text-xs text-white">입금완료</span>
              {ymd(row.paidDate!)}
            </span>
          ) : (
            <span className="text-[var(--color-muted)]">미입금</span>
          )}
        </td>
        <td className={cellCls}>{row.note ?? "—"}</td>
        <td className={cellCls}>
          <div className="flex flex-col items-start gap-1">
            <div className="flex gap-2">
              <button type="button" onClick={startEdit} className={btnEdit}>수정</button>
              <button type="button" onClick={handleDelete} disabled={pending} className={btnDelete}>삭제</button>
              {!paid && (
                <button type="button" onClick={() => setShowPay(true)} className={btnPay}>입금 확인</button>
              )}
            </div>
            {error && <p className="whitespace-normal text-xs text-[var(--color-danger)]">{error}</p>}
          </div>
        </td>
      </tr>
      {showPay && (
        <PaymentConfirmModal
          invoiceId={row.id}
          clientName={row.clientName}
          amount={row.amount}
          defaultDate={paid ? ymd(row.paidDate!) : ""}
          onClose={() => setShowPay(false)}
        />
      )}
    </>
  );
}
