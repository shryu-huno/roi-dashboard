"use client";

import { useState } from "react";
import { paginate } from "@/lib/clients/summary-view";
import { formatWon } from "@/lib/format";
import type { PmSummary } from "@/lib/data/metrics";

export function PmSummaryTable({ pms }: { pms: PmSummary[] }) {
  const [page, setPage] = useState(1);
  const { pageRows, totalPages, page: current } = paginate(pms, page);

  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">PM</th><th>담당 고객사</th><th>실적</th><th>지출</th><th>수익률</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((p) => (
            <tr key={p.pmId ?? "none"} className="border-b border-[var(--color-border)]">
              <td className="py-2">{p.label}</td>
              <td>{p.clientCount}</td>
              <td>{formatWon(p.performance)}</td>
              <td>{formatWon(p.expense)}</td>
              <td>준비중</td>
            </tr>
          ))}
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
