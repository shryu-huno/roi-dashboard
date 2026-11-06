"use client";

import { useRouter } from "next/navigation";
import { ClientCombobox } from "@/components/ClientCombobox";
import { addMonths, type Ym } from "@/lib/month-range";

// 실적 입력 필터: [고객사][월 ‹ ›]. 고객사를 고르거나 월을 바꾸면 [조회] 없이 바로 이동한다.
// 월 선택 목록은 선택한 달 기준 앞뒤 12개월이고, ‹ › 는 제한 없이 연 경계를 넘나든다.
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

  const options = Array.from({ length: 25 }, (_, i) => addMonths(current, i - 12));
  const stepBtn =
    "h-[38px] w-9 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] text-base text-[var(--color-muted)] hover:text-[var(--color-fg)]";

  return (
    <div className="mb-6 flex flex-wrap items-end gap-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        고객사
        <ClientCombobox clients={clients} defaultClientId={clientId} className="w-56" onSelect={(id) => go({ clientId: id })} />
      </label>
      <div className="flex flex-col text-xs text-[var(--color-muted)]">
        월
        <div className="mt-1 flex items-center gap-1.5">
          <button type="button" aria-label="이전 달" className={stepBtn} onClick={() => go({ ym: addMonths(current, -1) })}>‹</button>
          <select
            aria-label="월 선택"
            value={`${year}-${month}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              go({ ym: { year: y, month: m } });
            }}
            className="h-[38px] w-36 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-center text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]"
          >
            {options.map((o) => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                {o.year}년 {o.month}월
              </option>
            ))}
          </select>
          <button type="button" aria-label="다음 달" className={stepBtn} onClick={() => go({ ym: addMonths(current, 1) })}>›</button>
        </div>
      </div>
    </div>
  );
}
