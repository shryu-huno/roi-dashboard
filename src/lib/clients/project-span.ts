// 고객사 "가장 최근 프로젝트"의 계약기간이 해를 넘기는지 판단한다.
// 목록 카드·상세 화면에서 고객사명 옆 동그라미 배지(m/s)로 표시한다.
// - "m"(multi-year): 계약 시작·종료 연도가 다름(해를 넘김).
// - "s"(single-year): 시작·종료가 같은 해.
// - null: 시작/종료일이 하나라도 없어 판단 불가(배지 미표시).
export type PeriodSpan = "m" | "s";

function yearOf(d: Date | string | null): number | null {
  if (d == null) return null;
  if (d instanceof Date) return d.getFullYear();
  const m = /^(\d{4})/.exec(d);
  return m ? Number(m[1]) : null;
}

export function yearSpan(start: Date | string | null, end: Date | string | null): PeriodSpan | null {
  const ys = yearOf(start);
  const ye = yearOf(end);
  if (ys == null || ye == null) return null;
  return ys === ye ? "s" : "m";
}

// 고객사의 "가장 최근 프로젝트"(계약 시작일 최신, 없으면 등록일 최신 — metrics.ts 정렬 규칙과 동일)의 연도 스팬.
export function latestProjectSpan(
  projects: { contractStart: Date | null; contractEnd: Date | null; createdAt: Date }[],
): PeriodSpan | null {
  if (projects.length === 0) return null;
  const latest = [...projects].sort((a, b) => {
    const as = a.contractStart ? a.contractStart.getTime() : -Infinity; // 시작일 없으면 뒤로(nulls last)
    const bs = b.contractStart ? b.contractStart.getTime() : -Infinity;
    if (as !== bs) return bs - as; // 시작일 최신순
    return b.createdAt.getTime() - a.createdAt.getTime(); // tiebreak: 등록일 최신순
  })[0];
  return yearSpan(latest.contractStart, latest.contractEnd);
}
