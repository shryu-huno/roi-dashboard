export function KpiCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="text-xs text-[var(--color-muted)]">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-[var(--color-fg)]">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--color-muted)]">{sub}</div>}
    </div>
  );
}
