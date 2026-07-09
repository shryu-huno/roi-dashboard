export type PeriodKey = string; // "all" | "h1" | "h2" | "1".."12"

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "h1", label: "상반기" },
  { value: "h2", label: "하반기" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` })),
];

export function resolvePeriod(period: string): { startMonth: number; endMonth: number } {
  if (period === "h1") return { startMonth: 1, endMonth: 6 };
  if (period === "h2") return { startMonth: 7, endMonth: 12 };
  const m = Number(period);
  if (Number.isInteger(m) && m >= 1 && m <= 12) return { startMonth: m, endMonth: m };
  return { startMonth: 1, endMonth: 12 }; // "all" 및 잘못된 값
}

export function normalizePeriod(period: string | undefined): PeriodKey {
  if (!period) return "all";
  if (period === "all" || period === "h1" || period === "h2") return period;
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
