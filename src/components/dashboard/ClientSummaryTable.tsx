"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { filterClients, sortClients, paginate, type ClientRow, type SortMode } from "@/lib/clients/summary-view";
import { margin, attainment } from "@/lib/metrics/formulas";
import { formatWon, formatPercent } from "@/lib/format";

const SORTS: { value: SortMode; label: string }[] = [
  { value: "name", label: "가나다순" },
  { value: "pm", label: "PM별" },
  { value: "industry", label: "업종별" },
];

export function ClientSummaryTable({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => sortClients(filterClients(clients, query), sort), [clients, query, sort]);
  const { pageRows, totalPages, page: current } = paginate(sorted, page);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="고객사명 검색"
          className="w-56 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
        />
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value as SortMode); setPage(1); }}
          className="rounded border border-[var(--color-border)] px-3 py-2 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <span className="text-xs text-[var(--color-muted)]">{sorted.length}개</span>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">고객사</th><th>PM</th><th>업종</th><th>실적</th><th>지출</th><th>수익률</th><th>달성률</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((c) => (
            <tr key={c.id} className="border-b border-[var(--color-border)]">
              <td className="py-2">
                <Link href={`/clients/${c.id}`} className="text-[var(--color-primary)]">{c.name}</Link>
              </td>
              <td>{c.pmLabel}</td>
              <td>{c.industry ?? "—"}</td>
              <td>{formatWon(c.performance)}</td>
              <td>{formatWon(c.expense)}</td>
              <td>{formatPercent(margin(c.performance, c.expense))}</td>
              <td>{formatPercent(attainment(c.performance, c.contract))}</td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr><td colSpan={7} className="py-4 text-center text-[var(--color-muted)]">결과 없음</td></tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            onClick={() => setPage(current - 1)}
            disabled={current <= 1}
            className="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-40"
          >이전</button>
          <span className="text-[var(--color-muted)]">{current} / {totalPages}</span>
          <button
            onClick={() => setPage(current + 1)}
            disabled={current >= totalPages}
            className="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-40"
          >다음</button>
        </div>
      )}
    </div>
  );
}
