"use client";

import { useState } from "react";
import type { ClientTaskMatrix } from "@/lib/data/metrics";
import { formatWon } from "@/lib/format";

const WINDOW = 12;

// 진행률(실적/계약) 표기: 소수 둘째 자리에서 반올림해 첫째 자리까지. 분모가 없으면 null.
function progressLabel(actual: number, planned: number | null): string {
  if (!planned || planned <= 0) return "-";
  return `${(Math.round((actual / planned) * 1000) / 10).toFixed(1)}%`;
}

// 과업별 월 실적 표. 선택 프로젝트의 계약기간 전체를 해를 넘겨 전개하며, 12개월 초과 시 좌우
// 화살표로 1개월씩 창을 이동한다(한 화면 최대 12개월). 상단 연도 행으로 연 구분을 표시하고, 합계·진행률
// 열은 어느 창을 보든 계약기간 전체 기준으로 고정한다. 셀 값은 금액/횟수 토글(기본: 금액).
// 횟수 모드에서 count가 없는 셀(금액전용 과업·기록 없는 달)은 "-", 금액 모드에서 0원 셀도 "-"로 표시한다.
export function TaskPerfTable({ matrix }: { matrix: ClientTaskMatrix }) {
  const [byCount, setByCount] = useState(false);
  const [offset, setOffset] = useState(0);

  const { columns, tasks } = matrix;
  const maxOffset = Math.max(0, columns.length - WINDOW);
  const start = Math.min(offset, maxOffset);
  const windowCols = columns.slice(start, start + WINDOW);
  const paged = columns.length > WINDOW;

  // 연속 연도 그룹(연도 헤더 행 colSpan용).
  const groups: { year: number; count: number }[] = [];
  for (const c of windowCols) {
    const last = groups[groups.length - 1];
    if (last && last.year === c.year) last.count++;
    else groups.push({ year: c.year, count: 1 });
  }
  const first = windowCols[0];
  const lastCol = windowCols[windowCols.length - 1];
  const pad = (m: number) => String(m).padStart(2, "0");
  const rangeLabel = first ? `${first.year}.${pad(first.month)} ~ ${lastCol.year}.${pad(lastCol.month)}` : "";

  return (
    <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">과업별 월 실적 (계약 기간)</h2>
        <div className="flex items-center gap-3 text-sm text-[var(--color-fg)]">
          {paged && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOffset((o) => Math.max(0, Math.min(o, maxOffset) - 1))}
                disabled={start === 0}
                aria-label="이전 달"
                className="rounded border border-[var(--color-border)] px-2 py-0.5 leading-none disabled:opacity-40"
              >
                ‹
              </button>
              <span className="whitespace-nowrap text-xs text-[var(--color-muted)]">{rangeLabel}</span>
              <button
                type="button"
                onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))}
                disabled={start >= maxOffset}
                aria-label="다음 달"
                className="rounded border border-[var(--color-border)] px-2 py-0.5 leading-none disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
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
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th rowSpan={2} className="py-2 pr-3 text-left align-bottom">과업</th>
              {groups.map((g, i) => (
                <th key={`${g.year}-${i}`} colSpan={g.count} className="px-2 text-center font-semibold">
                  {g.year}
                </th>
              ))}
              <th rowSpan={2} className="px-2 text-right align-bottom">합계</th>
              <th rowSpan={2} className="pl-2 text-right align-bottom">진행률</th>
            </tr>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              {windowCols.map((c) => (
                <th key={`${c.year}-${c.month}`} className="px-2 text-right whitespace-nowrap font-normal">
                  {c.month}월
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const windowCells = t.cells.slice(start, start + WINDOW);
              // 횟수 합계는 전체 계약 기간에서 count가 있는 셀만 더한다. 전부 null(금액전용 과업)이면 "-".
              const counts = t.cells.filter((c) => c.count != null);
              // 소수 횟수 합계는 부동소수 잔재(0.30000…)를 없애기 위해 소수 2자리로 반올림한다.
              const countTotal = counts.length
                ? Math.round(counts.reduce((s, c) => s + (c.count ?? 0), 0) * 100) / 100
                : null;
              return (
                <tr key={t.id} className="border-b border-[var(--color-border)]">
                  <td className="py-2 pr-3 whitespace-nowrap">{t.name}</td>
                  {windowCells.map((cell) => (
                    <td key={`${cell.year}-${cell.month}`} className="px-2 text-right whitespace-nowrap">
                      {byCount ? (cell.count == null ? "-" : `${cell.count}회`) : cell.amount === 0 ? "-" : formatWon(cell.amount)}
                    </td>
                  ))}
                  <td className="px-2 text-right font-semibold whitespace-nowrap">
                    {byCount ? (countTotal == null ? "-" : `${countTotal}회`) : t.total === 0 ? "-" : formatWon(t.total)}
                  </td>
                  <td className="pl-2 text-right whitespace-nowrap text-[var(--color-muted)]">
                    {byCount ? progressLabel(countTotal ?? 0, t.contractCount) : progressLabel(t.total, t.contract)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
