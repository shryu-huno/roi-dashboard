// 파트 현황의 조회 기간(월별 / 분기별 / 전체) 해석. 화면과 조회가 같은 규칙을 쓰도록 순수 함수로 둔다.
// 세 가지 모두 "한 해 안"의 조회라서 집계와 계약금 계산은 전체 현황과 같은 연도 기준 그대로다.
import { YEAR_MIN, intParam, type Ym } from "@/lib/month-range";

export type StatusMode = "month" | "quarter" | "all";

export type StatusPeriodInput = { mode?: string; year?: string; month?: string; quarter?: string };

export type StatusPeriod = {
  mode: StatusMode;
  year: number; // 집계 연도
  month: number | null; // 월별일 때만 선택 월
  quarter: number | null; // 분기별일 때만 선택 분기(1~4)
};

const quarterOf = (month: number) => Math.floor((month - 1) / 3) + 1;

/**
 * 조회 조건 → 집계 기준.
 *  - 전체(기본): 선택한 연도 전체(연도 누적).
 *  - 월별: 선택한 연·월(올해의 아직 오지 않은 달은 이번 달로).
 *  - 분기별: 선택한 연·분기(올해의 아직 시작하지 않은 분기는 이번 분기로).
 * ctx.maxYm은 이번 달. 연도는 2000년부터 올해까지.
 */
export function resolveStatusPeriod(sp: StatusPeriodInput, ctx: { maxYm: Ym }): StatusPeriod {
  const mode: StatusMode = sp.mode === "month" || sp.mode === "quarter" ? sp.mode : "all";
  const { maxYm } = ctx;
  const askedYear = intParam(sp.year);
  const year = askedYear !== null ? Math.min(Math.max(askedYear, YEAR_MIN), maxYm.year) : maxYm.year;
  const current = year === maxYm.year;

  if (mode === "month") {
    const asked = Number(sp.month);
    let month = Number.isInteger(asked) && asked >= 1 && asked <= 12 ? asked : current ? maxYm.month : 12;
    if (current && month > maxYm.month) month = maxYm.month;
    return { mode, year, month, quarter: null };
  }
  if (mode === "quarter") {
    const asked = Number(sp.quarter);
    let quarter = Number.isInteger(asked) && asked >= 1 && asked <= 4 ? asked : current ? quarterOf(maxYm.month) : 4;
    if (current && quarter > quarterOf(maxYm.month)) quarter = quarterOf(maxYm.month);
    return { mode, year, month: null, quarter };
  }
  return { mode, year, month: null, quarter: null };
}
