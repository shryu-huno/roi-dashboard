import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/period";

type Option = { value: string; label: string };

export function PeriodFilter({
  year,
  period,
  action,
  projects,
  projectId,
  options = PERIOD_OPTIONS,
}: {
  year: number;
  period: string;
  action?: string;
  projects?: { id: string; name: string }[];
  projectId?: string;
  options?: { value: PeriodKey; label: string }[] | Option[];
}) {
  return (
    <form
      method="get"
      action={action}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      {projects && projects.length > 0 && (
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          프로젝트
          <select
            name="projectId"
            defaultValue={projectId}
            className="mt-1 w-56 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
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
          {options.map((o) => (
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
