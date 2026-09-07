"use client";

import { useState } from "react";
import { formatWon } from "@/lib/format";

export function TrendChart({
  points,
}: {
  points: { month: number; performance: number }[];
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const W = 720, H = 200, pad = 24;
  const maxPerf = Math.max(1, ...points.map((p) => p.performance));
  const barW = (W - pad * 2) / points.length;
  const x = (i: number) => pad + i * barW + barW / 2;
  const yPerf = (v: number) => H - pad - (v / maxPerf) * (H - pad * 2);

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-[var(--color-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[var(--color-primary)]" />
          월별 실적(막대)
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="max-w-full" onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => (
          <rect
            key={p.month}
            x={x(i) - barW * 0.35}
            y={yPerf(p.performance)}
            width={barW * 0.7}
            height={H - pad - yPerf(p.performance)}
            fill="var(--color-primary)"
            opacity="0.85"
          />
        ))}
        {/* 월별 투명 오버레이 — 컬럼 전체를 호버 영역으로 잡아 막대 어디에 올려도 툴팁 표시 */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.month}`}
            x={x(i) - barW / 2}
            y={pad}
            width={barW}
            height={H - pad * 2}
            fill="transparent"
            style={{ pointerEvents: "all" }}
            onMouseEnter={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
          />
        ))}
        {points.map((p, i) => (
          <text key={`lbl-${p.month}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
            {p.month}월
          </text>
        ))}
      </svg>
      {hover && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-[var(--color-fg)] px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <div className="mb-1 font-semibold">{points[hover.i].month}월</div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-[var(--color-primary)]" />
            실적 {formatWon(points[hover.i].performance)}
          </div>
        </div>
      )}
    </div>
  );
}
