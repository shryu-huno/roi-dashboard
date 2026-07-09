import { formatWon } from "@/lib/format";

export function BarList({ items }: { items: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) {
    return <p className="text-sm text-[var(--color-muted)]">데이터가 없습니다.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate text-xs text-[var(--color-fg)]">{it.label}</div>
          <div className="relative h-5 flex-1 rounded bg-[var(--color-bg)]">
            <div className="h-5 rounded bg-[var(--color-primary)]" style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
          <div className="w-28 shrink-0 text-right text-xs text-[var(--color-fg)]">{formatWon(it.value)}</div>
          {it.sub && <div className="w-16 shrink-0 text-right text-xs text-[var(--color-muted)]">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}
