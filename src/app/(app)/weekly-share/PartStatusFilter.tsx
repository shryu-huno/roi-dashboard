"use client";

import { useRouter } from "next/navigation";
import { ymValue, type Ym } from "@/lib/month-range";
import { YearMonthControls } from "./YearMonthControls";

const selectCls =
  "h-[38px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";

// 파트 현황 필터: [파트] [연도 ‹ ›] [월 ‹ ›]. 연도는 카드·차트·표의 집계 연도, 월은 "선택 월 실적"과 최근 3개월 기준이다.
export function PartStatusFilter({
  groups, partId, ym, minYm, maxYm, tv,
}: {
  groups: { id: string; name: string }[];
  partId: string; // "" = 전체
  ym: Ym;
  minYm: Ym;
  maxYm: Ym;
  tv: string;
}) {
  const router = useRouter();
  function go(next: { part?: string; ym?: Ym }) {
    const params = new URLSearchParams({ tab: "status", ym: ymValue(next.ym ?? ym), tv });
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
        <YearMonthControls ym={ym} minYm={minYm} maxYm={maxYm} onChange={(target) => go({ ym: target })} />
      </div>
    </div>
  );
}
