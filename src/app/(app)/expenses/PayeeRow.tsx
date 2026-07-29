"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxType } from "@prisma/client";
import type { PayeeRow as PayeeRowData } from "@/lib/data/payees";
import { BANKS, TAX_TYPE_LABELS, taxTypeLabel } from "@/lib/labels";
import { updatePayeeAction } from "./payees/actions";

const TAX_BADGE_CLASS: Record<TaxType, string> = {
  TAX_INVOICE: "bg-blue-100 text-blue-700",
  TAX_FREE_INVOICE: "bg-green-100 text-green-700",
  BUSINESS_INCOME: "bg-amber-100 text-amber-700",
  OTHER_INCOME: "bg-gray-100 text-gray-600",
  CASH_RECEIPT: "bg-teal-100 text-teal-700",
  HANDWRITTEN_INVOICE: "bg-purple-100 text-purple-700",
};

function TaxBadge({ taxType }: { taxType: TaxType }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TAX_BADGE_CLASS[taxType]}`}>
      {taxTypeLabel(taxType)}
    </span>
  );
}

function AttachmentCell({ hasAttachment, onClick }: { hasAttachment: boolean; onClick: () => void }) {
  if (hasAttachment) {
    return (
      <button type="button" onClick={onClick} className="whitespace-nowrap text-sm text-[var(--color-primary)] hover:underline">
        📎 첨부완료
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-block whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-[var(--color-danger)] hover:underline"
    >
      ⚠ 미첨부
    </button>
  );
}

const inputCls =
  "w-full rounded border-2 border-[var(--color-primary)]/50 bg-[var(--color-surface)] px-2 py-1.5 text-center text-sm shadow-sm focus:border-[var(--color-primary)] focus:outline-none";
const cellCls = "whitespace-nowrap px-3 py-2 text-center align-middle";

export function PayeeRow({
  row,
  isEditing,
  isSelected,
  onToggleSelect,
  onStartEdit,
  onStopEdit,
  onOpenAttachment,
}: {
  row: PayeeRowData;
  isEditing: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onOpenAttachment: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const bizNameRef = useRef<HTMLInputElement>(null);
  const bankNameRef = useRef<HTMLSelectElement>(null);
  const accountNumberRef = useRef<HTMLInputElement>(null);
  const accountHolderRef = useRef<HTMLInputElement>(null);
  const taxTypeRef = useRef<HTMLSelectElement>(null);

  // DB 값이 BANKS 목록 밖이면(과거 데이터 등) select가 첫 옵션으로 조용히 바뀌는 것을 막기 위해
  // 현재 값을 옵션 맨 앞에 추가한다.
  const bankOptions: readonly string[] = BANKS.includes(row.bankName as (typeof BANKS)[number])
    ? BANKS
    : [row.bankName, ...BANKS];

  function handleCancel() {
    setError(null);
    onStopEdit();
  }

  function handleSave() {
    const formData = new FormData();
    formData.set("bizName", bizNameRef.current!.value);
    formData.set("bankName", bankNameRef.current!.value);
    formData.set("accountNumber", accountNumberRef.current!.value);
    formData.set("accountHolder", accountHolderRef.current!.value);
    formData.set("taxType", taxTypeRef.current!.value);

    setError(null);
    startTransition(async () => {
      const result = await updatePayeeAction(row.id, formData);
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
      <td className={`${cellCls} font-medium text-[var(--color-primary)]`}>{row.keyId}</td>

      <td className={cellCls}>
        {isEditing ? <input ref={bizNameRef} className={inputCls} defaultValue={row.bizName} /> : row.bizName}
      </td>

      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.bizNumberMasked}</td>

      <td className={cellCls}>
        {isEditing ? (
          <select ref={bankNameRef} className={inputCls} defaultValue={row.bankName}>
            {bankOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        ) : (
          row.bankName
        )}
      </td>

      <td className={cellCls}>
        {isEditing ? <input ref={accountNumberRef} className={inputCls} defaultValue={row.accountNumber} /> : row.accountNumber}
      </td>

      <td className={cellCls}>
        {isEditing ? <input ref={accountHolderRef} className={inputCls} defaultValue={row.accountHolder} /> : row.accountHolder}
      </td>

      <td className={cellCls}>
        {isEditing ? (
          <select ref={taxTypeRef} className={inputCls} defaultValue={taxTypeLabel(row.taxType)}>
            {TAX_TYPE_LABELS.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
        ) : (
          <TaxBadge taxType={row.taxType} />
        )}
      </td>

      <td className={cellCls}>
        <AttachmentCell hasAttachment={row.hasBizCert || row.hasBankbook} onClick={onOpenAttachment} />
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
          <button
            type="button"
            onClick={onStartEdit}
            className="text-[var(--color-muted)] hover:text-[var(--color-primary)]"
            aria-label="편집"
          >
            ✏️
          </button>
        )}
      </td>
    </tr>
  );
}
