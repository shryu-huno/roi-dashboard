import type { PeriodSpan } from "@/lib/clients/project-span";

// 고객사명 옆 동그라미 배지: 가장 최근 프로젝트의 계약기간이 해를 넘기면 m, 같은 해면 s.
export function PeriodSpanBadge({ span }: { span: PeriodSpan | null }) {
  if (!span) return null;
  const title = span === "m" ? "최근 프로젝트 계약기간이 해를 넘김" : "최근 프로젝트 계약기간이 같은 해";
  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-xs font-semibold leading-none text-[var(--color-muted)]"
    >
      {span}
    </span>
  );
}
