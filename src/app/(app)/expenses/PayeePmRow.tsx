"use client";

import type { TaxType } from "@prisma/client";
import type { PayeePmRow as PayeePmRowData } from "@/lib/data/payees";
import { taxTypeLabel } from "@/lib/labels";

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

const cellCls = "whitespace-nowrap px-3 py-2 text-center align-middle";

export function PayeePmRow({
  row,
  onOpenAttachment,
}: {
  row: PayeePmRowData;
  onOpenAttachment: () => void;
}) {
  return (
    <tr className="border-b border-[var(--color-border)]">
      <td className={`${cellCls} font-medium text-[var(--color-primary)]`}>{row.keyId.toUpperCase()}</td>
      <td className={cellCls}>{row.bizName}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.phoneMasked}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.bankNameMasked}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.accountNumberMasked}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.accountHolderMasked}</td>

      <td className={cellCls}>
        <TaxBadge taxType={row.taxType} />
      </td>

      <td className={cellCls}>
        <AttachmentCell hasAttachment={row.hasBizCert || row.hasBankbook} onClick={onOpenAttachment} />
      </td>
    </tr>
  );
}
