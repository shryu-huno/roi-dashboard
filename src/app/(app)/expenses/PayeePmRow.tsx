"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxType } from "@prisma/client";
import type { PayeePmRow as PayeePmRowData } from "@/lib/data/payees";
import { TAX_TYPE_LABELS, taxTypeLabel } from "@/lib/labels";
import { updatePayeePmAction } from "./payees/actions";

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

export function PayeePmRow({
  row,
  isEditing,
  isSelected,
  onToggleSelect,
  onStartEdit,
  onStopEdit,
  onOpenAttachment,
  onRequestDelete,
}: {
  row: PayeePmRowData;
  isEditing: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onOpenAttachment: () => void;
  onRequestDelete: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const bizNameRef = useRef<HTMLInputElement>(null);
  const taxTypeRef = useRef<HTMLSelectElement>(null);

  function handleCancel() {
    setError(null);
    onStopEdit();
  }

  function handleSave() {
    const formData = new FormData();
    formData.set("bizName", bizNameRef.current!.value);
    formData.set("taxType", taxTypeRef.current!.value);

    setError(null);
    startTransition(async () => {
      const result = await updatePayeePmAction(row.id, formData);
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
      <td className={`${cellCls} font-medium text-[var(--color-primary)]`}>{row.keyId.toUpperCase()}</td>

      <td className={cellCls}>
        {isEditing ? <input ref={bizNameRef} className={inputCls} defaultValue={row.bizName} /> : row.bizName}
      </td>

      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.phoneMasked}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.bankNameMasked}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.accountNumberMasked}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.accountHolderMasked}</td>

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
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={onStartEdit}
              className="text-[var(--color-muted)] hover:text-[var(--color-primary)]"
              aria-label="편집"
            >
              ✏️
            </button>
            <button
              type="button"
              onClick={onRequestDelete}
              className="text-[var(--color-muted)] hover:text-[var(--color-danger)]"
              aria-label="삭제"
            >
              🗑️
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
