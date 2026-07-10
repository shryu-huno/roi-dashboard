"use client";

import { useState } from "react";
import { formatWon, formatPercent } from "@/lib/format";

export function TrendChart({
  points,
}: {
  points: { month: number; performance: number; margin: number | null }[];
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const W = 720, H = 200, pad = 24;
  const maxPerf = Math.max(1, ...points.map((p) => p.performance));
  const barW = (W - pad * 2) / points.length;
  const x = (i: number) => pad + i * barW + barW / 2;
  const yPerf = (v: number) => H - pad - (v / maxPerf) * (H - pad * 2);
  // 수익률 라인: 0~1 구간으로 clamp (적자·음수는 하단 고정). 실제 값은 툴팁에 표기.
  const yMargin = (m: number) => {
    const clamped = Math.max(0, Math.min(1, m));
    return H - pad - clamped * (H - pad * 2);
  };
  const linePts = points
    .filter((p) => p.margin !== null)
    .map((p) => `${x(points.indexOf(p))},${yMargin(p.margin as number)}`)
    .join(" ");

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-[var(--color-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[var(--color-primary)]" />
          월별 실적(막대)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[var(--color-success)]" />
          월별 수익률(라인)
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
        {linePts && <polyline points={linePts} fill="none" stroke="var(--color-success)" strokeWidth="2" />}
        {points
          .filter((p) => p.margin !== null)
          .map((p) => (
            <circle
              key={p.month}
              cx={x(points.indexOf(p))}
              cy={yMargin(p.margin as number)}
              r="4"
              fill="var(--color-success)"
            />
          ))}
        {/* 월별 투명 오버레이 — 컬럼 전체를 호버 영역으로 잡아 막대·점 어디에 올려도 툴팁 표시 */}
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
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-2.5 bg-[var(--color-success)]" />
            수익률 {formatPercent(points[hover.i].margin)}
          </div>
        </div>
      )}
    </div>
  );
}
