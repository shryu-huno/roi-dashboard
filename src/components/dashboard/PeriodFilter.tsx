import { PERIOD_OPTIONS } from "@/lib/period";

export function PeriodFilter({ year, period, action }: { year: number; period: string; action?: string }) {
  return (
    <form
      method="get"
      action={action}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        연도
        <input
          type="number"
          name="year"
          defaultValue={year}
          className="mt-1 w-28 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        기간
        <select
          name="period"
          defaultValue={period}
          className="mt-1 w-40 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">
        조회
      </button>
    </form>
  );
}
