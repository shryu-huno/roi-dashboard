import { formatThousands } from "@/lib/format";
import type { ConsultingFieldRow } from "@/lib/data/expenses";

// 상담비 요약표 — 상담분야별 건수·금액. 상담분야가 세부 항목 구분 기준이다.
export function ConsultingSummaryTable({
  rows,
  total,
  totalCount,
}: {
  rows: ConsultingFieldRow[];
  total: number;
  totalCount: number;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
          <th className="py-2">상담분야</th>
          <th className="text-right">건수</th>
          <th className="text-right">금액</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.field} className="border-b border-[var(--color-border)]">
            <td className="py-2">{r.field}</td>
            <td className="py-2 text-right tabular-nums">{r.count.toLocaleString("ko-KR")}</td>
            <td className="py-2 text-right tabular-nums">{formatThousands(r.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-[var(--color-border)] font-medium">
          <td className="py-2">합계</td>
          <td className="py-2 text-right tabular-nums">{totalCount.toLocaleString("ko-KR")}</td>
          <td className="py-2 text-right tabular-nums">{formatThousands(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
