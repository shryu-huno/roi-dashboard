"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatWon, formatWonCompact } from "@/lib/format";
import { niceMax } from "@/lib/chart-axis";

type Series = { id: string; name: string; color: string; values: number[] };
export type ChartColumn = {
  label: string; // 축 라벨("11월" 또는 해를 넘는 구간의 "25.11")
  title: string; // 툴팁·접근성 제목("2026년 11월")
  href: string; // 누르면 이동할 주소(그 달의 월별 보기)
  disabled: boolean; // 아직 오지 않은 달
  selected: boolean; // 강조(월별에서 선택한 달)
  partial: boolean; // 진행 중인 달(옅게 표시)
};

// 월별 실적 추이: 파트별 누적 막대. 열 개수는 조회 구간의 달 수(한 해면 12개).
// 막대 폭 ≤24px, 데이터 쪽 끝만 4px 둥글게, 구간 사이 2px 표면 간격. 막대를 누르면 그 달의 월별 보기로 이동한다.
// 값은 툴팁·표 보기에서도 모두 볼 수 있다(청록은 대비가 낮아 표 보기를 함께 둔다).
export function PartTrendChart({
  columns, series, totals,
}: {
  columns: ChartColumn[];
  series: Series[];
  totals: number[];
}) {
  const router = useRouter();
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const max = niceMax(Math.max(...totals));
  const ticks = [0, 1, 2, 3, 4].map((k) => (max * k) / 4);
  const multi = series.length > 1;
  // 월별은 선택한 달 하나, 분기별은 선택한 분기의 세 달이 강조된다. 값 라벨은 하나만 강조될 때만 붙인다(겹침 방지).
  const labelSelected = columns.filter((c) => c.selected).length === 1;

  const show = (i: number, el: HTMLElement, pointer?: { x: number; y: number }) => {
    const r = el.getBoundingClientRect();
    setTip({ i, x: pointer?.x ?? r.left + r.width / 2, y: pointer?.y ?? r.top });
  };

  return (
    <div>
      {multi && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
          {columns.some((c) => c.partial) && <span>진행 중인 달은 옅게 표시 · 막대를 누르면 그 달의 월별 보기로 이동해요</span>}
        </div>
      )}
      <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2" onMouseLeave={() => setTip(null)}>
        <div className="relative h-[200px]" aria-hidden="true">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 translate-y-1/2 text-[11px] tabular-nums text-[var(--color-muted)]"
              style={{ bottom: `${(t / max) * 100}%` }}
            >
              {formatWonCompact(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <div className="relative flex h-[200px] items-end gap-1">
            {ticks.map((t) => (
              <span key={t} className="absolute left-0 right-0 h-px bg-[var(--color-border)]" style={{ bottom: `${(t / max) * 100}%` }} />
            ))}
            {totals.map((total, i) => {
              const col = columns[i];
              const h = (total / max) * 100;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={col.disabled}
                  aria-label={`${col.title} 실적 ${formatWon(total)}`}
                  aria-current={col.selected ? "true" : undefined}
                  onClick={() => router.push(col.href)}
                  onMouseMove={(e) => !col.disabled && show(i, e.currentTarget, { x: e.clientX, y: e.clientY })}
                  onFocus={(e) => !col.disabled && show(i, e.currentTarget)}
                  onBlur={() => setTip(null)}
                  className={`relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-md disabled:cursor-default ${
                    col.selected ? "bg-[var(--color-hover)]" : "hover:bg-[var(--color-hover)]"
                  }`}
                >
                  {labelSelected && col.selected && total > 0 && (
                    <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11.5px] font-bold tabular-nums text-[var(--color-fg)]" style={{ bottom: `calc(${h}% + 4px)` }}>
                      {formatWonCompact(total)}
                    </span>
                  )}
                  <span
                    className={`flex w-[min(24px,70%)] flex-col-reverse gap-[2px] ${col.partial ? "opacity-50" : ""}`}
                    style={{ height: `${h}%` }}
                  >
                    {series.map((s) =>
                      s.values[i] > 0 ? (
                        <i
                          key={s.id}
                          className="block min-h-[2px] basis-0 last:rounded-t-[4px]"
                          style={{ flexGrow: s.values[i], background: s.color }}
                        />
                      ) : null,
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-1 text-xs" aria-hidden="true">
            {columns.map((col, i) => (
              <span
                key={i}
                className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-center ${col.selected ? "font-bold text-[var(--color-primary)]" : col.disabled ? "text-[var(--color-muted)] opacity-60" : "text-[var(--color-muted)]"}`}
              >
                {col.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {tip && (
        <div
          className="pointer-events-none fixed z-50 min-w-[11rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.max(8, tip.x - 90), top: Math.max(8, tip.y - 12 - (multi ? 24 + series.length * 18 : 40)) }}
        >
          <div className="mb-1 font-bold">
            {columns[tip.i].title}
            {columns[tip.i].partial ? " · 진행 중" : ""}
          </div>
          {series.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
                <i className="inline-block h-[2px] w-3 rounded" style={{ background: s.color }} />
                {s.name}
              </span>
              <b className="tabular-nums">{formatWon(s.values[tip.i])}</b>
            </div>
          ))}
          {multi && (
            <div className="mt-1 flex justify-between gap-4 border-t border-[var(--color-border)] pt-1">
              <span className="text-[var(--color-muted)]">합계</span>
              <b className="tabular-nums">{formatWon(totals[tip.i])}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
