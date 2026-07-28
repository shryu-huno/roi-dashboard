import Link from "next/link";
import { formatThousands } from "@/lib/format";
import type { ExpenseSummaryKey } from "@/lib/expense-summary";
import { ymValue, type Ym } from "@/lib/month-range";

type Row = { key: ExpenseSummaryKey; label: string; amount: number };

// 전체 내역 요약표 — 읽기전용. 금액은 표시만, 상세내역은 상세 페이지로 이동한다.
export function ExpenseSummaryTable({
  clientId, from, to, rows,
}: {
  clientId: string; from: Ym; to: Ym; rows: Row[];
}) {
  const period = `from=${ymValue(from)}&to=${ymValue(to)}`;
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
          <th className="py-2">분류</th>
          <th className="text-right">금액</th>
          <th className="text-right">상세내역</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-[var(--color-border)]">
            <td className="py-2">{r.label}</td>
            <td className="py-2 text-right tabular-nums">{formatThousands(r.amount)}</td>
            <td className="py-2 text-right">
              <Link
                href={`/expenses/detail?clientId=${clientId}&${period}&category=${r.key}`}
                className="inline-block rounded bg-[var(--color-primary)] px-3 py-1 text-white"
              >
                상세보기
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
