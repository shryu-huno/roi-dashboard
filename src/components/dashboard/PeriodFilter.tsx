import { PERIOD_OPTIONS } from "@/lib/period";

export function PeriodFilter({ year, period, action }: { year: number; period: string; action?: string }) {
  return (
    <form method="get" action={action} className="mb-6 flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        연도
        <input
          type="number"
          name="year"
          defaultValue={year}
          className="w-24 rounded border border-[var(--color-border)] px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        기간
        <select
          name="period"
          defaultValue={period}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-sm"
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">
        조회
      </button>
    </form>
  );
}
