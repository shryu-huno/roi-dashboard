"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaymentRequestClientCombobox } from "@/components/PaymentRequestClientCombobox";
import { formatThousands, digitsOnly } from "@/lib/format";
import { createInvoiceAction } from "./actions";
import { OK } from "@/lib/action-state";

// 청구 입력 폼. 예시 화면과 동일한 카드형 레이아웃. 고객사는 배정된 고객사만 검색 선택,
// 청구금액(VAT 포함)·계산서 발행일자·비고를 받아 저장하면 하단 청구 리스트에 반영된다.
export function InvoiceForm({ clients }: { clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [clientId, setClientId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return setError("고객사를 선택하세요.");
    if (digitsOnly(amount) === "") return setError("청구금액을 입력하세요.");
    if (!issueDate) return setError("계산서 발행일자를 입력하세요.");

    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("amount", amount);
    fd.set("issueDate", issueDate);
    fd.set("note", note);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await createInvoiceAction(OK, fd);
      if (res.ok) {
        setClientId(null);
        setAmount("");
        setIssueDate("");
        setNote("");
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? "저장 중 오류가 발생했습니다.");
      }
    });
  }

  const labelCls = "flex flex-col text-xs text-[var(--color-muted)]";
  const inputCls = "mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm";

  return (
    <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <label className={labelCls}>
        고객사
        <div className="mt-1 w-52">
          <PaymentRequestClientCombobox clients={clients} selectedId={clientId} onSelect={(c) => setClientId(c?.id ?? null)} />
        </div>
      </label>
      <label className={labelCls}>
        청구금액(VAT 포함)
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(formatThousands(e.target.value))}
          placeholder="0"
          className={`${inputCls} w-40 text-right`}
        />
      </label>
      <label className={labelCls}>
        계산서 발행일자
        <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={`${inputCls} w-44`} />
      </label>
      <label className={labelCls}>
        비고
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="(선택)" className={`${inputCls} w-56`} />
      </label>
      <button type="submit" disabled={pending} className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white disabled:opacity-60">
        {pending ? "저장 중..." : "저장"}
      </button>
      {saved && <span className="text-sm text-[var(--color-primary)]">저장되었습니다.</span>}
      {error && <span className="text-sm text-[var(--color-danger)]">{error}</span>}
    </form>
  );
}
