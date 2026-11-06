"use client";

import { useRouter } from "next/navigation";
import type { Ym } from "@/lib/month-range";
import type { StatusMode } from "@/lib/part-status-period";
import { YearMonthControls } from "./YearMonthControls";

const selectCls =
  "h-[38px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";
const MODES: { value: StatusMode; label: string }[] = [
  { value: "month", label: "월별" },
  { value: "all", label: "전체" },
  { value: "range", label: "기간 설정" },
];

// 파트 현황 필터: [파트] · [기간: 월별/전체/기간 설정] · 월별=연도+월, 전체=연도(그 해 전체), 기간 설정=시작일~종료일.
// 히스토리 탭과 같은 모양이다. 바꾸면 [조회] 없이 바로 이동하고, 모든 조건은 URL에 담긴다.
export function PartStatusFilter({
  groups, partId, mode, year, month, from, to, today, minYm, maxYm, tv,
}: {
  groups: { id: string; name: string }[];
  partId: string; // "" = 전체
  mode: StatusMode;
  year: number;
  month: number | null;
  from: string;
  to: string;
  today: string;
  minYm: Ym;
  maxYm: Ym;
  tv: string;
}) {
  const router = useRouter();
  // 월별로 바꿀 때의 기본 월: 올해면 이번 달, 아니면 12월.
  const defaultMonth = year >= maxYm.year ? maxYm.month : 12;

  type Patch = Partial<{ part: string; mode: StatusMode; year: number; month: number; from: string; to: string }>;
  function go(patch: Patch) {
    const next = { part: partId, mode, year, month: month ?? defaultMonth, from, to, ...patch };
    const params = new URLSearchParams({ tab: "status", mode: next.mode, tv });
    if (next.mode !== "range") params.set("year", String(next.year));
    if (next.mode === "month") params.set("month", String(next.month));
    if (next.mode === "range") {
      if (next.from) params.set("from", next.from);
      if (next.to) params.set("to", next.to);
    }
    if (next.part) params.set("part", next.part);
    router.push(`/weekly-share?${params.toString()}`);
  }

  // 기간 설정으로 바꿀 때 시작일·종료일이 없으면 지금 보던 연도(올해면 오늘까지)로 채운다.
  const rangeDefaults = { from: from || `${year}-01-01`, to: to || (year >= maxYm.year ? today : `${year}-12-31`) };

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          파트
          <select className={`mt-1 w-36 ${selectCls}`} value={partId} onChange={(e) => go({ part: e.target.value })}>
            <option value="">전체</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-col text-xs text-[var(--color-muted)]">
          기간
          <div className="mt-1 inline-flex h-[38px] items-center gap-0.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5" role="group" aria-label="기간">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={mode === m.value}
                onClick={() => go({ mode: m.value, ...(m.value === "range" ? rangeDefaults : {}) })}
                className={`h-8 rounded-[8px] px-3 text-sm font-medium ${
                  mode === m.value ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm" : "text-[var(--color-muted)]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {mode !== "range" && (
          <YearMonthControls
            ym={{ year, month: month ?? defaultMonth }}
            minYm={minYm}
            maxYm={maxYm}
            hideMonth={mode === "all"}
            onChange={(target) => go({ year: target.year, month: target.month })}
          />
        )}
        {mode === "range" && (
          <div className="flex flex-col text-xs text-[var(--color-muted)]">
            날짜
            <div className="mt-1 flex items-center gap-1.5">
              <input type="date" aria-label="시작일" max={today} value={from} onChange={(e) => go({ from: e.target.value })} className={`w-40 ${selectCls}`} />
              <span>~</span>
              <input type="date" aria-label="종료일" max={today} value={to} onChange={(e) => go({ to: e.target.value })} className={`w-40 ${selectCls}`} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
