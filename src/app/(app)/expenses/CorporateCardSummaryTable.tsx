import { formatThousands } from "@/lib/format";
import type { CorporateCardItemRow } from "@/lib/data/expenses";

// 법인카드 요약표 — 항목별 금액. 항목이 세부 구분 기준이다(상담비와 달리 건수 없음).
export function CorporateCardSummaryTable({
  rows,
  total,
}: {
  rows: CorporateCardItemRow[];
  total: number;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
          <th className="py-2">항목</th>
          <th className="text-right">금액</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.item} className="border-b border-[var(--color-border)]">
            <td className="py-2">{r.item}</td>
            <td className="py-2 text-right tabular-nums">{formatThousands(r.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-[var(--color-border)] font-medium">
          <td className="py-2">합계</td>
          <td className="py-2 text-right tabular-nums">{formatThousands(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
