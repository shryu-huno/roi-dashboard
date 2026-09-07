"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatWon } from "@/lib/format";
import { confirmPaymentAction } from "./actions";

// 입금 확인 모달. 입금일자(YYYY-MM-DD)를 받아 청구 항목에 기록한다.
export function PaymentConfirmModal({
  invoiceId,
  clientName,
  amount,
  defaultDate,
  onClose,
}: {
  invoiceId: string;
  clientName: string;
  amount: number;
  defaultDate: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [paidDate, setPaidDate] = useState(defaultDate);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    if (!paidDate) return setError("입금일자를 입력하세요.");
    const fd = new FormData();
    fd.set("paidDate", paidDate);
    setError(null);
    startTransition(async () => {
      const res = await confirmPaymentAction(invoiceId, fd);
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setError(res.error ?? "저장 중 오류가 발생했습니다.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">입금 확인</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>

        <p className="mb-4 text-sm text-[var(--color-muted)]">
          {clientName} · {formatWon(amount)}
        </p>

        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          입금일자
          <input
            type="date"
            value={paidDate}
            onChange={(e) => setPaidDate(e.target.value)}
            className="mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
          <button type="button" onClick={handleSave} disabled={pending} className="rounded bg-[var(--color-success)] px-5 py-2 text-sm text-white disabled:opacity-60">
            {pending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
