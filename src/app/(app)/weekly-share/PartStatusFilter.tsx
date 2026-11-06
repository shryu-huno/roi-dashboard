"use client";

import { useRouter } from "next/navigation";
import type { Ym } from "@/lib/month-range";
import type { StatusMode } from "@/lib/part-status-period";
import { YearMonthControls } from "./YearMonthControls";
import { FIELD } from "./filter-style";

const selectCls =
  "h-[38px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";
const MODES: { value: StatusMode; label: string }[] = [
  { value: "month", label: "월별" },
  { value: "quarter", label: "분기별" },
  { value: "all", label: "전체" },
];
const quarterOf = (month: number) => Math.floor((month - 1) / 3) + 1;

// 파트 현황 필터: [파트] · [기간: 월별/분기별/전체] · 월별=연도+월, 분기별=연도+분기, 전체=연도(그 해 1~12월).
// 세 가지 모두 한 해 안의 조회다. 바꾸면 [조회] 없이 바로 이동하고, 모든 조건은 URL에 담긴다.
export function PartStatusFilter({
  groups, partId, mode, year, month, quarter, minYm, maxYm, tv,
}: {
  groups: { id: string; name: string }[];
  partId: string; // "" = 전체
  mode: StatusMode;
  year: number;
  month: number | null;
  quarter: number | null;
  minYm: Ym;
  maxYm: Ym;
  tv: string;
}) {
  const router = useRouter();
  const current = year >= maxYm.year;
  // 모드를 바꿀 때의 기본값: 올해면 이번 달·이번 분기, 아니면 12월·4분기.
  const defaultMonth = current ? maxYm.month : 12;
  const defaultQuarter = current ? quarterOf(maxYm.month) : 4;
  const lastQuarter = current ? quarterOf(maxYm.month) : 4; // 올해라면 아직 시작하지 않은 분기는 고를 수 없다

  type Patch = Partial<{ part: string; mode: StatusMode; year: number; month: number; quarter: number }>;
  function go(patch: Patch) {
    const next = { part: partId, mode, year, month: month ?? defaultMonth, quarter: quarter ?? defaultQuarter, ...patch };
    const params = new URLSearchParams({ tab: "status", mode: next.mode, year: String(next.year), tv });
    if (next.mode === "month") params.set("month", String(next.month));
    if (next.mode === "quarter") params.set("quarter", String(next.quarter));
    if (next.part) params.set("part", next.part);
    router.push(`/weekly-share?${params.toString()}`);
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className={FIELD}>
          파트
          <select className={`mt-1.5 w-36 ${selectCls}`} value={partId} onChange={(e) => go({ part: e.target.value })}>
            <option value="">전체</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>

        <div className={FIELD}>
          기간
          <div className="mt-1.5 inline-flex h-[38px] items-center gap-0.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5" role="group" aria-label="기간">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={mode === m.value}
                onClick={() => go({ mode: m.value })}
                className={`h-8 rounded-[8px] px-3 text-sm font-medium ${
                  mode === m.value ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm" : "text-[var(--color-muted)]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <YearMonthControls
          ym={{ year, month: month ?? defaultMonth }}
          minYm={minYm}
          maxYm={maxYm}
          hideMonth={mode !== "month"}
          onChange={(target) => go({ year: target.year, month: target.month })}
        />

        {mode === "quarter" && (
          <div className={FIELD}>
            분기
            <div className="mt-1.5 inline-flex h-[38px] items-center gap-0.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5" role="group" aria-label="분기">
              {[1, 2, 3, 4].map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={q > lastQuarter}
                  aria-pressed={quarter === q}
                  onClick={() => go({ quarter: q })}
                  className={`h-8 rounded-[8px] px-3 text-sm font-medium disabled:cursor-default disabled:opacity-40 ${
                    quarter === q ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm" : "text-[var(--color-muted)]"
                  }`}
                >
                  {q}분기
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
