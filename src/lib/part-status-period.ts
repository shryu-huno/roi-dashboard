// 파트 현황의 조회 기간(월별 / 전체 / 기간 설정) 해석. 화면과 조회 함수가 같은 규칙을 쓰도록 순수 함수로 둔다.
import { addMonths, YEAR_MIN, type Ym } from "@/lib/month-range";
import type { MonthWindow } from "@/lib/metrics/proration";

export type StatusMode = "month" | "all" | "range";

export type StatusPeriodInput = { mode?: string; year?: string; month?: string; from?: string; to?: string };

export type StatusPeriod = {
  mode: StatusMode;
  year: number; // 월별·전체의 집계 연도(기간 설정이면 종료일의 연도)
  month: number | null; // 월별일 때만 선택 월, 그 외 null
  window: MonthWindow; // 집계 구간(월별·전체는 그 해 1~12월, 기간 설정은 시작일~종료일의 달들)
  from: string; // 기간 설정의 시작일 "YYYY-MM-DD"(기본값 적용 후)
  to: string; // 종료일
  invalid: boolean; // 시작일이 종료일보다 늦음(구간은 기본값으로 둔다)
  capped: boolean; // 구간이 너무 길어 최근 MAX_RANGE_MONTHS개월로 줄였다
};

/** 기간 설정의 최대 길이(달). 월별 막대가 너무 많아지지 않게 한다. */
export const MAX_RANGE_MONTHS = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ymOf = (d: string): Ym => ({ year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) });
const idx = (y: Ym) => y.year * 12 + y.month;

/**
 * 조회 조건 → 집계 구간.
 *  - 월별: 선택한 연·월(올해의 아직 오지 않은 달은 이번 달로). 구간은 그 해 1~12월(그 해 안에서 추이를 함께 본다).
 *  - 전체: 선택한 연도 전체(연도 누적).
 *  - 기간 설정: 시작일~종료일이 걸친 달들. 종료일은 오늘까지, 기본은 올해 1월 1일 ~ 오늘.
 * ctx.maxYm은 이번 달, ctx.today는 한국 시간 오늘("YYYY-MM-DD").
 */
export function resolveStatusPeriod(sp: StatusPeriodInput, ctx: { maxYm: Ym; today: string }): StatusPeriod {
  const mode: StatusMode = sp.mode === "month" || sp.mode === "range" ? sp.mode : "all";
  const yearWindow = (y: number): MonthWindow => ({ from: { year: y, month: 1 }, to: { year: y, month: 12 } });

  const askedYear = Number(sp.year);
  const year = Number.isInteger(askedYear) ? Math.min(Math.max(askedYear, YEAR_MIN), ctx.maxYm.year) : ctx.maxYm.year;

  if (mode !== "range") {
    let month: number | null = null;
    if (mode === "month") {
      const asked = Number(sp.month);
      const fallback = year === ctx.maxYm.year ? ctx.maxYm.month : 12;
      month = Number.isInteger(asked) && asked >= 1 && asked <= 12 ? asked : fallback;
      if (year === ctx.maxYm.year && month > ctx.maxYm.month) month = ctx.maxYm.month;
    }
    return { mode, year, month, window: yearWindow(year), from: "", to: "", invalid: false, capped: false };
  }

  const defaultFrom = `${ctx.maxYm.year}-01-01`;
  const floor = `${YEAR_MIN}-01-01`;
  let from = sp.from && DATE.test(sp.from) ? sp.from : defaultFrom;
  let to = sp.to && DATE.test(sp.to) ? sp.to : ctx.today;
  if (to > ctx.today) to = ctx.today;
  if (from < floor) from = floor;

  const invalid = from > to;
  const useFrom = invalid ? defaultFrom : from;
  const useTo = invalid ? ctx.today : to;
  const win: MonthWindow = { from: ymOf(useFrom), to: ymOf(useTo) };
  let capped = false;
  if (idx(win.to) - idx(win.from) + 1 > MAX_RANGE_MONTHS) {
    capped = true;
    win.from = addMonths(win.to, -(MAX_RANGE_MONTHS - 1));
  }
  return { mode, year: win.to.year, month: null, window: win, from: useFrom, to: useTo, invalid, capped };
}
