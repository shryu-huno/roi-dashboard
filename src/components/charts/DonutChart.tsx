import { formatWon } from "@/lib/format";

const COLORS = [
  "#2563EB", "#10B981", "#F43F5E", "#F59E0B", "#8B5CF6", "#06B6D4", "#EC4899",
  "#84CC16", "#6366F1", "#14B8A6", "#EF4444", "#A855F7", "#64748B",
];

export function DonutChart({ segments }: { segments: { label: string; value: number }[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <p className="text-sm text-[var(--color-muted)]">데이터가 없습니다.</p>;
  }
  const R = 60, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <g transform="translate(80,80) rotate(-90)">
          {segments.map((s, i) => {
            const frac = s.value / total;
            const dash = frac * C;
            const el = (
              <circle
                key={s.label}
                r={R}
                fill="none"
                stroke={COLORS[i % COLORS.length]}
                strokeWidth="24"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </g>
      </svg>
      <ul className="flex flex-col gap-1 text-xs">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="w-40 text-[var(--color-fg)]">{s.label}</span>
            <span className="w-28 text-right text-[var(--color-fg)]">{formatWon(s.value)}</span>
            <span className="w-12 text-right text-[var(--color-muted)]">{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
