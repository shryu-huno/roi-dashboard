import { resolvePeriod } from "@/lib/period";

/**
 * 선택 연도+기간 창과 프로젝트 계약기간의 월 겹침 비율(계약기간 월수 균등분배).
 * 달성률 분모를 "해당 기간에 걸친 몫"으로 비례 배분하는 데 쓴다.
 *
 * 계약기간(contractStart/End)이 둘 다 있으면 그 창으로, 하나라도 없으면 선택 연도 1~12월을
 * 계약 창으로 간주한다(projectWindowMonths의 폴백과 동일) → period=all이면 ratio=1.
 *
 * 월 인덱싱은 metrics.ts의 toYm과 동일하게 로컬 게터(getFullYear/getMonth)를 쓴다(타임존 일관).
 */
export function overlapRatio(
  year: number,
  period: string,
  contractStart: Date | null,
  contractEnd: Date | null,
): number {
  const { startMonth, endMonth } = resolvePeriod(period);
  const idx = (y: number, m: number) => y * 12 + (m - 1);
  const winFrom = idx(year, startMonth);
  const winTo = idx(year, endMonth);

  const hasRange = contractStart != null && contractEnd != null;
  const aRaw = hasRange ? idx(contractStart!.getFullYear(), contractStart!.getMonth() + 1) : idx(year, 1);
  const bRaw = hasRange ? idx(contractEnd!.getFullYear(), contractEnd!.getMonth() + 1) : idx(year, 12);
  const projFrom = Math.min(aRaw, bRaw);
  const projTo = Math.max(aRaw, bRaw);

  const totalMonths = projTo - projFrom + 1;
  const overlap = Math.max(0, Math.min(winTo, projTo) - Math.max(winFrom, projFrom) + 1);
  return totalMonths === 0 ? 0 : overlap / totalMonths;
}
