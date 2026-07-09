import { formatWon } from "@/lib/format";

export function FunnelChart({
  steps,
}: {
  steps: { label: string; amount: number; rate: string | null }[];
}) {
  const max = Math.max(1, ...steps.map((s) => s.amount));
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center gap-3">
          <div className="w-16 shrink-0 text-xs text-[var(--color-muted)]">{s.label}</div>
          <div className="relative h-7 flex-1 rounded bg-[var(--color-bg)]">
            <div
              className="h-7 rounded bg-[var(--color-primary)]"
              style={{ width: `${(s.amount / max) * 100}%` }}
            />
          </div>
          <div className="w-32 shrink-0 text-right text-xs text-[var(--color-fg)]">{formatWon(s.amount)}</div>
          <div className="w-16 shrink-0 text-right text-xs text-[var(--color-muted)]">{s.rate ?? ""}</div>
        </div>
      ))}
    </div>
  );
}
