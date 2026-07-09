export function TrendChart({
  points,
}: {
  points: { month: number; performance: number; margin: number | null }[];
}) {
  const W = 720, H = 200, pad = 24;
  const maxPerf = Math.max(1, ...points.map((p) => p.performance));
  const barW = (W - pad * 2) / points.length;
  const x = (i: number) => pad + i * barW + barW / 2;
  const yPerf = (v: number) => H - pad - (v / maxPerf) * (H - pad * 2);
  // 수익률 라인: -1..1 → H 매핑 (0.5 중앙 기준 단순화: 0=하단 pad, 1=상단 pad)
  const yMargin = (m: number) => {
    const clamped = Math.max(0, Math.min(1, m));
    return H - pad - clamped * (H - pad * 2);
  };
  const linePts = points
    .filter((p) => p.margin !== null)
    .map((p) => `${x(points.indexOf(p))},${yMargin(p.margin as number)}`)
    .join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="max-w-full">
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
      {points.map((p, i) => (
        <text key={p.month} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
          {p.month}
        </text>
      ))}
    </svg>
  );
}
