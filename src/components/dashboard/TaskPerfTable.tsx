"use client";

import { useState } from "react";
import type { TaskPerf } from "@/lib/data/metrics";
import { formatWon } from "@/lib/format";

// 과업별 월 실적 표. 셀 값을 금액/횟수로 전환하는 토글을 제공한다(기본: 금액).
// 횟수 모드에서 count가 없는 셀(금액전용 과업·기록 없는 달)은 "-"로 표시하고, 합계 열은 항상 금액 합계를 유지한다.
export function TaskPerfTable({ tasks, months }: { tasks: TaskPerf[]; months: number[] }) {
  const [byCount, setByCount] = useState(false);

  return (
    <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">과업별 월 실적 (선택 구간)</h2>
        <div className="flex items-center gap-2 text-sm text-[var(--color-fg)]">
          <button
            type="button"
            role="switch"
            aria-checked={byCount}
            onClick={() => setByCount((v) => !v)}
            className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-[var(--color-border)] transition-colors"
            style={{ backgroundColor: byCount ? "var(--color-primary)" : "var(--color-surface)" }}
          >
            <span
              className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
              style={{ transform: byCount ? "translateX(18px)" : "translateX(2px)" }}
            />
          </button>
          <span>{byCount ? "횟수" : "금액"}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
              <th className="py-2 pr-3">과업</th>
              {months.map((m) => (
                <th key={m} className="px-2 text-right whitespace-nowrap">{m}월</th>
              ))}
              <th className="px-2 text-right">합계</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-b border-[var(--color-border)]">
                <td className="py-2 pr-3 whitespace-nowrap">{t.name}</td>
                {t.monthly.map((cell) => (
                  <td key={cell.month} className="px-2 text-right whitespace-nowrap">
                    {byCount ? (cell.count == null ? "-" : `${cell.count}회`) : formatWon(cell.amount)}
                  </td>
                ))}
                <td className="px-2 text-right font-semibold whitespace-nowrap">{formatWon(t.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
