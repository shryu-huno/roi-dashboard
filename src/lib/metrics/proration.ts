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

export type MonthWindow = { from: { year: number; month: number }; to: { year: number; month: number } };

/**
 * 임의의 월 구간(해를 넘어도 됨)과 프로젝트 계약기간의 월 겹침 비율 = 겹치는 월수 ÷ 계약 전체 월수.
 * 한 해 안의 구간이면 overlapRatio(연도+기간)와 같은 값이다(파트 현황의 "기간 설정"이 전체 현황과 같은 기준을 쓰도록).
 * 계약기간이 없으면 매년 1~12월 계약으로 보고, 구간이 걸친 연도마다 (걸친 월수 ÷ 12)를 더한다.
 */
export function rangeOverlapRatio(win: MonthWindow, contractStart: Date | null, contractEnd: Date | null): number {
  const idx = (y: number, m: number) => y * 12 + (m - 1);
  const winFrom = idx(win.from.year, win.from.month);
  const winTo = idx(win.to.year, win.to.month);
  if (winTo < winFrom) return 0;

  if (contractStart == null || contractEnd == null) {
    let total = 0;
    for (let y = win.from.year; y <= win.to.year; y++) {
      const a = Math.max(winFrom, idx(y, 1));
      const b = Math.min(winTo, idx(y, 12));
      if (b >= a) total += (b - a + 1) / 12;
    }
    return total;
  }
  const aRaw = idx(contractStart.getFullYear(), contractStart.getMonth() + 1);
  const bRaw = idx(contractEnd.getFullYear(), contractEnd.getMonth() + 1);
  const projFrom = Math.min(aRaw, bRaw);
  const projTo = Math.max(aRaw, bRaw);
  const totalMonths = projTo - projFrom + 1;
  const overlap = Math.max(0, Math.min(winTo, projTo) - Math.max(winFrom, projFrom) + 1);
  return totalMonths === 0 ? 0 : overlap / totalMonths;
}
