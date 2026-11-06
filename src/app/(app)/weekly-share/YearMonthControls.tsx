"use client";

import { CommitInput } from "@/components/CommitInput";
import { addMonths, clampYm, parseMonthInput, parseYearInput, type Ym } from "@/lib/month-range";

const stepBtn =
  "h-[38px] w-9 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-base text-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:cursor-default disabled:opacity-40 disabled:hover:text-[var(--color-muted)]";

const idx = (y: Ym) => y.year * 12 + y.month;

// 연도 [‹ 2026년 ›] · 월 [‹ 11월 ›]. 둘 다 직접 입력이 되고, 이동 범위(min~max) 밖의 값은 범위 안으로 맞춘다.
// 주간 공유 탭과 히스토리 탭이 같이 쓴다.
export function YearMonthControls({
  ym, minYm, maxYm, onChange, hideMonth,
}: {
  ym: Ym;
  minYm: Ym;
  maxYm: Ym;
  onChange: (next: Ym) => void;
  hideMonth?: boolean; // 연도만 고를 때(파트 현황의 "전체")
}) {
  const go = (target: Ym) => onChange(clampYm(target, minYm, maxYm));
  const prev = addMonths(ym, -1);
  const next = addMonths(ym, 1);
  return (
    <>
      <div className="flex flex-col text-xs text-[var(--color-muted)]">
        연도
        <div className="mt-1 flex items-center gap-1.5">
          <button type="button" aria-label="이전 연도" className={stepBtn} disabled={ym.year <= minYm.year} onClick={() => go({ year: ym.year - 1, month: ym.month })}>‹</button>
          <CommitInput label="연도" value={ym.year} parse={parseYearInput} onCommit={(y) => go({ year: y, month: ym.month })} suffix="년" className="w-28 pl-3 pr-7" />
          <button type="button" aria-label="다음 연도" className={stepBtn} disabled={ym.year >= maxYm.year} onClick={() => go({ year: ym.year + 1, month: ym.month })}>›</button>
        </div>
      </div>
      {!hideMonth && (
        <div className="flex flex-col text-xs text-[var(--color-muted)]">
          월
          <div className="mt-1 flex items-center gap-1.5">
            <button type="button" aria-label="이전 달" className={stepBtn} disabled={idx(prev) < idx(minYm)} onClick={() => go(prev)}>‹</button>
            <CommitInput label="월" value={ym.month} parse={parseMonthInput} onCommit={(m) => go({ year: ym.year, month: m })} suffix="월" className="w-28 pl-3 pr-7" />
            <button type="button" aria-label="다음 달" className={stepBtn} disabled={idx(next) > idx(maxYm)} onClick={() => go(next)}>›</button>
          </div>
        </div>
      )}
    </>
  );
}
