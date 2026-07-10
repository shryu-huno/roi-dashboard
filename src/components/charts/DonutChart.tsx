"use client";

import { useState } from "react";
import { formatWon } from "@/lib/format";

const COLORS = [
  "#2563EB", "#10B981", "#F43F5E", "#F59E0B", "#8B5CF6", "#06B6D4", "#EC4899",
  "#84CC16", "#6366F1", "#14B8A6", "#EF4444", "#A855F7", "#64748B",
];

export function DonutChart({ segments }: { segments: { label: string; value: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <p className="text-sm text-[var(--color-muted)]">데이터가 없습니다.</p>;
  }
  const R = 60, C = 2 * Math.PI * R;
  const activeSeg = active === null ? null : segments[active];
  const dashes = segments.map((s) => (s.value / total) * C);
  const arcs = dashes.map((dash, i) => ({
    dash,
    offset: dashes.slice(0, i).reduce((sum, d) => sum + d, 0),
  }));
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative" style={{ width: 160, height: 160 }}>
        <svg width="160" height="160" viewBox="0 0 160 160">
          <g transform="translate(80,80) rotate(-90)">
            {segments.map((s, i) => {
              const { dash, offset } = arcs[i];
              const dim = active !== null && active !== i;
              return (
                <circle
                  key={s.label}
                  r={R}
                  fill="none"
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={active === i ? 30 : 24}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  opacity={dim ? 0.35 : 1}
                  style={{ cursor: "pointer", transition: "opacity 120ms, stroke-width 120ms" }}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
                />
              );
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {activeSeg ? (
            <>
              <span className="max-w-[92px] text-[11px] font-medium leading-tight text-[var(--color-fg)]">
                {activeSeg.label}
              </span>
              <span className="text-xs font-semibold text-[var(--color-fg)]">{formatWon(activeSeg.value)}</span>
              <span className="text-[11px] text-[var(--color-muted)]">
                {((activeSeg.value / total) * 100).toFixed(1)}%
              </span>
            </>
          ) : (
            <>
              <span className="text-[10px] text-[var(--color-muted)]">합계</span>
              <span className="text-xs font-semibold text-[var(--color-fg)]">{formatWon(total)}</span>
            </>
          )}
        </div>
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        {segments.map((s, i) => (
          <li
            key={s.label}
            className="flex items-center gap-2 rounded px-1 py-0.5"
            style={{ background: active === i ? "var(--color-border)" : "transparent", cursor: "pointer" }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
          >
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
