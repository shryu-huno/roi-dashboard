"use client";

import { useRouter } from "next/navigation";
import type { Ym } from "@/lib/month-range";
import { YearMonthControls } from "./YearMonthControls";

const selectCls =
  "h-[38px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";

// 파트 현황 필터: [파트] [연도 ‹ ›] [월 전체 ‹ ›]. 연도는 카드·차트·표의 집계 연도다.
// 월은 "전체"(기본, 연도 누적만)이거나 특정 월(그 달 실적과 최근 3개월 기준)이다.
export function PartStatusFilter({
  groups, partId, year, month, minYm, maxYm, tv,
}: {
  groups: { id: string; name: string }[];
  partId: string; // "" = 전체
  year: number;
  month: number | null; // null = 월 전체
  minYm: Ym;
  maxYm: Ym;
  tv: string;
}) {
  const router = useRouter();
  // 월이 "전체"일 때 월 조작부에 넘길 자리표시 값(화살표·입력은 비활성이라 쓰이지 않는다). 올해면 이번 달, 아니면 12월.
  const lastMonth = year >= maxYm.year ? maxYm.month : 12;

  function go(next: { part?: string; year?: number; month?: number | null }) {
    const params = new URLSearchParams({ tab: "status", tv });
    params.set("year", String(next.year ?? year));
    const m = next.month === undefined ? month : next.month;
    params.set("month", m === null ? "all" : String(m));
    const part = next.part ?? partId;
    if (part) params.set("part", part);
    router.push(`/weekly-share?${params.toString()}`);
  }

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
        <YearMonthControls
          ym={{ year, month: month ?? lastMonth }}
          minYm={minYm}
          maxYm={maxYm}
          onChange={(target) => go({ year: target.year, month: month === null ? null : target.month })}
          monthAll={{ active: month === null, onToggle: () => go({ month: month === null ? lastMonth : null }) }}
        />
      </div>
    </div>
  );
}
