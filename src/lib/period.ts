export type PeriodKey = string; // "all" | "h1" | "h2" | "q1".."q4" | "1".."12"

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "h1", label: "상반기" },
  { value: "h2", label: "하반기" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` })),
];

// 분기별을 포함한 옵션(고객사별 대시보드용). 전사 대시보드는 PERIOD_OPTIONS를 그대로 사용.
export const PERIOD_OPTIONS_WITH_QUARTERS: { value: PeriodKey; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "h1", label: "상반기" },
  { value: "h2", label: "하반기" },
  ...Array.from({ length: 4 }, (_, i) => ({ value: `q${i + 1}`, label: `${i + 1}분기` })),
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` })),
];

export function resolvePeriod(period: string): { startMonth: number; endMonth: number } {
  if (period === "h1") return { startMonth: 1, endMonth: 6 };
  if (period === "h2") return { startMonth: 7, endMonth: 12 };
  if (period === "q1") return { startMonth: 1, endMonth: 3 };
  if (period === "q2") return { startMonth: 4, endMonth: 6 };
  if (period === "q3") return { startMonth: 7, endMonth: 9 };
  if (period === "q4") return { startMonth: 10, endMonth: 12 };
  const m = Number(period);
  if (Number.isInteger(m) && m >= 1 && m <= 12) return { startMonth: m, endMonth: m };
  return { startMonth: 1, endMonth: 12 }; // "all" 및 잘못된 값
}

export function normalizePeriod(period: string | undefined): PeriodKey {
  if (!period) return "all";
  if (period === "all" || period === "h1" || period === "h2") return period;
  if (period === "q1" || period === "q2" || period === "q3" || period === "q4") return period;
  const m = Number(period);
  if (Number.isInteger(m) && m >= 1 && m <= 12) return String(m);
  return "all";
}

export function parsePeriodParams(
  sp: { year?: string; period?: string },
  fallbackYear: number,
): { year: number; period: PeriodKey } {
  const y = Number(sp.year);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : fallbackYear;
  return { year, period: normalizePeriod(sp.period) };
}
