"use client";

import { useRouter } from "next/navigation";
import { ClientCombobox } from "@/components/ClientCombobox";
import { CommitInput } from "@/components/CommitInput";
import { addMonths, parseYearInput, parseMonthInput, YEAR_MIN, YEAR_MAX, type Ym } from "@/lib/month-range";

const stepBtn =
  "h-[38px] w-9 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-base text-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:cursor-default disabled:opacity-40 disabled:hover:text-[var(--color-muted)]";

// 실적 입력 필터: [고객사] [연도 ‹ ›] [월 ‹ ›]. 고르거나 바꾸면 [조회] 없이 바로 이동한다.
// 연도: ‹ ›(±1년)·직접 입력. 월: ‹ ›·직접 입력. 월 ‹ ›는 12월↔1월에서 연도도 함께 넘어간다.
export function PerformanceFilter({
  clients, clientId, year, month,
}: {
  clients: { id: string; name: string }[];
  clientId?: string;
  year: number;
  month: number;
}) {
  const router = useRouter();
  const current: Ym = { year, month };

  function go(next: { clientId?: string; ym?: Ym }) {
    const id = next.clientId ?? clientId;
    const ym = next.ym ?? current;
    const params = new URLSearchParams();
    if (id) params.set("clientId", id);
    params.set("year", String(ym.year));
    params.set("month", String(ym.month));
    router.push(`/performance?${params.toString()}`);
  }

  const inRange = (ym: Ym) => ym.year >= YEAR_MIN && ym.year <= YEAR_MAX;
  const prevMonth = addMonths(current, -1);
  const nextMonth = addMonths(current, 1);

  return (
    <div className="mb-6 flex flex-wrap items-end gap-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        고객사
        <ClientCombobox clients={clients} defaultClientId={clientId} className="w-56" onSelect={(id) => go({ clientId: id })} />
      </label>

      <div className="flex flex-col text-xs text-[var(--color-muted)]">
        연도
        <div className="mt-1 flex items-center gap-1.5">
          <button type="button" aria-label="이전 연도" className={stepBtn} disabled={year <= YEAR_MIN} onClick={() => go({ ym: { year: year - 1, month } })}>‹</button>
          <CommitInput label="연도" value={year} parse={parseYearInput} onCommit={(y) => go({ ym: { year: y, month } })} suffix="년" className="w-28 pl-3 pr-7" />
          <button type="button" aria-label="다음 연도" className={stepBtn} disabled={year >= YEAR_MAX} onClick={() => go({ ym: { year: year + 1, month } })}>›</button>
        </div>
      </div>

      <div className="flex flex-col text-xs text-[var(--color-muted)]">
        월
        <div className="mt-1 flex items-center gap-1.5">
          <button type="button" aria-label="이전 달" className={stepBtn} disabled={!inRange(prevMonth)} onClick={() => go({ ym: prevMonth })}>‹</button>
          <CommitInput label="월" value={month} parse={parseMonthInput} onCommit={(m) => go({ ym: { year, month: m } })} suffix="월" className="w-28 pl-3 pr-7" />
          <button type="button" aria-label="다음 달" className={stepBtn} disabled={!inRange(nextMonth)} onClick={() => go({ ym: nextMonth })}>›</button>
        </div>
      </div>
    </div>
  );
}
