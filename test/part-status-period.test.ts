import { describe, it, expect } from "vitest";
import { resolveStatusPeriod } from "@/lib/part-status-period";
import { eachMonth } from "@/lib/month-range";

const ctx = { maxYm: { year: 2026, month: 11 }, today: "2026-11-06" };
const count = (w: { from: { year: number; month: number }; to: { year: number; month: number } }) => eachMonth(w.from, w.to).length;

describe("resolveStatusPeriod — 파트 현황의 조회 기간 해석", () => {
  it("아무 조건이 없으면 '전체'(올해 1~12월 누적)", () => {
    const p = resolveStatusPeriod({}, ctx);
    expect(p).toMatchObject({ mode: "all", year: 2026, month: null, invalid: false, capped: false });
    expect(p.window).toEqual({ from: { year: 2026, month: 1 }, to: { year: 2026, month: 12 } });
  });

  it("월별: 연·월을 그대로, 올해의 아직 오지 않은 달은 이번 달로 맞춘다", () => {
    expect(resolveStatusPeriod({ mode: "month", year: "2026", month: "3" }, ctx)).toMatchObject({ mode: "month", year: 2026, month: 3 });
    expect(resolveStatusPeriod({ mode: "month", year: "2026", month: "12" }, ctx).month).toBe(11);
    expect(resolveStatusPeriod({ mode: "month", year: "2025", month: "12" }, ctx).month).toBe(12); // 지난해는 그대로
  });

  it("월별에서 월이 없거나 잘못되면 올해는 이번 달, 지난해는 12월", () => {
    expect(resolveStatusPeriod({ mode: "month", year: "2026" }, ctx).month).toBe(11);
    expect(resolveStatusPeriod({ mode: "month", year: "2026", month: "abc" }, ctx).month).toBe(11);
    expect(resolveStatusPeriod({ mode: "month", year: "2025" }, ctx).month).toBe(12);
  });

  it("월별·전체의 구간은 그 해 1~12월(월별이어도 한 해 안에서 추이를 함께 본다)", () => {
    const p = resolveStatusPeriod({ mode: "month", year: "2025", month: "6" }, ctx);
    expect(p.window).toEqual({ from: { year: 2025, month: 1 }, to: { year: 2025, month: 12 } });
  });

  it("연도는 2000년부터 올해까지로 맞춘다", () => {
    expect(resolveStatusPeriod({ mode: "all", year: "1990" }, ctx).year).toBe(2000);
    expect(resolveStatusPeriod({ mode: "all", year: "2099" }, ctx).year).toBe(2026);
    expect(resolveStatusPeriod({ mode: "all", year: "x" }, ctx).year).toBe(2026);
  });

  it("기간 설정: 시작일~종료일의 달들이 구간이 된다(해를 넘어도 됨)", () => {
    const p = resolveStatusPeriod({ mode: "range", from: "2025-10-15", to: "2026-02-03" }, ctx);
    expect(p).toMatchObject({ mode: "range", from: "2025-10-15", to: "2026-02-03", invalid: false });
    expect(p.window).toEqual({ from: { year: 2025, month: 10 }, to: { year: 2026, month: 2 } });
    expect(count(p.window)).toBe(5);
  });

  it("기간 설정 기본값은 올해 1월 1일 ~ 오늘, 종료일이 미래면 오늘로 맞춘다", () => {
    const d = resolveStatusPeriod({ mode: "range" }, ctx);
    expect(d).toMatchObject({ from: "2026-01-01", to: "2026-11-06" });
    expect(resolveStatusPeriod({ mode: "range", from: "2026-05-01", to: "2027-03-01" }, ctx).to).toBe("2026-11-06");
  });

  it("시작일이 종료일보다 늦으면 invalid, 구간은 기본값으로 둔다", () => {
    const p = resolveStatusPeriod({ mode: "range", from: "2026-08-01", to: "2026-03-01" }, ctx);
    expect(p.invalid).toBe(true);
    expect(p.window).toEqual({ from: { year: 2026, month: 1 }, to: { year: 2026, month: 11 } });
  });

  it("너무 긴 구간은 최근 60개월로 줄이고 capped로 알린다", () => {
    const p = resolveStatusPeriod({ mode: "range", from: "2000-01-01", to: "2026-11-06" }, ctx);
    expect(p.capped).toBe(true);
    expect(count(p.window)).toBe(60);
    expect(p.window.to).toEqual({ year: 2026, month: 11 });
  });

  it("날짜 형식이 아니면 기본값으로 본다", () => {
    expect(resolveStatusPeriod({ mode: "range", from: "어제", to: "" }, ctx)).toMatchObject({ from: "2026-01-01", to: "2026-11-06" });
  });
});
