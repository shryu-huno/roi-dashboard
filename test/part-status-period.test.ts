import { describe, it, expect } from "vitest";
import { resolveStatusPeriod } from "@/lib/part-status-period";

const ctx = { maxYm: { year: 2026, month: 11 } }; // 이번 달 2026-11 → 4분기 진행 중

describe("resolveStatusPeriod — 파트 현황의 조회 기간 해석(월별 / 분기별 / 전체)", () => {
  it("아무 조건이 없으면 '전체'(올해 1~12월 누적)", () => {
    expect(resolveStatusPeriod({}, ctx)).toEqual({ mode: "all", year: 2026, month: null, quarter: null });
  });

  it("월별: 연·월을 그대로, 올해의 아직 오지 않은 달은 이번 달로 맞춘다", () => {
    expect(resolveStatusPeriod({ mode: "month", year: "2026", month: "3" }, ctx)).toEqual({ mode: "month", year: 2026, month: 3, quarter: null });
    expect(resolveStatusPeriod({ mode: "month", year: "2026", month: "12" }, ctx).month).toBe(11);
    expect(resolveStatusPeriod({ mode: "month", year: "2025", month: "12" }, ctx).month).toBe(12); // 지난해는 그대로
  });

  it("연도가 빈 값이면 없는 것으로 보고 올해로 한다(0년으로 읽지 않는다)", () => {
    expect(resolveStatusPeriod({ mode: "month", year: "", month: "3" }, ctx)).toEqual({ mode: "month", year: 2026, month: 3, quarter: null });
    expect(resolveStatusPeriod({ year: "  " }, ctx).year).toBe(2026);
  });

  it("월별에서 월이 없거나 잘못되면 올해는 이번 달, 지난해는 12월", () => {
    expect(resolveStatusPeriod({ mode: "month", year: "2026" }, ctx).month).toBe(11);
    expect(resolveStatusPeriod({ mode: "month", year: "2026", month: "abc" }, ctx).month).toBe(11);
    expect(resolveStatusPeriod({ mode: "month", year: "2025" }, ctx).month).toBe(12);
  });

  it("분기별: 연·분기(1~4)를 그대로, 올해의 아직 시작하지 않은 분기는 이번 분기로 맞춘다", () => {
    expect(resolveStatusPeriod({ mode: "quarter", year: "2026", quarter: "2" }, ctx)).toEqual({ mode: "quarter", year: 2026, month: null, quarter: 2 });
    expect(resolveStatusPeriod({ mode: "quarter", year: "2025", quarter: "4" }, ctx).quarter).toBe(4);
    // 이번 달이 8월(3분기)이면 4분기는 아직 시작하지 않았다
    expect(resolveStatusPeriod({ mode: "quarter", year: "2026", quarter: "4" }, { maxYm: { year: 2026, month: 8 } }).quarter).toBe(3);
  });

  it("분기별에서 분기가 없거나 잘못되면 올해는 이번 분기, 지난해는 4분기", () => {
    expect(resolveStatusPeriod({ mode: "quarter", year: "2026" }, ctx).quarter).toBe(4);
    expect(resolveStatusPeriod({ mode: "quarter", year: "2026", quarter: "9" }, { maxYm: { year: 2026, month: 5 } }).quarter).toBe(2);
    expect(resolveStatusPeriod({ mode: "quarter", year: "2025", quarter: "0" }, ctx).quarter).toBe(4);
  });

  it("연도는 2000년부터 올해까지로 맞춘다", () => {
    expect(resolveStatusPeriod({ mode: "all", year: "1990" }, ctx).year).toBe(2000);
    expect(resolveStatusPeriod({ mode: "all", year: "2099" }, ctx).year).toBe(2026);
    expect(resolveStatusPeriod({ mode: "all", year: "x" }, ctx).year).toBe(2026);
  });

  it("알 수 없는 모드(예전 주소의 range 등)는 '전체'로 본다", () => {
    expect(resolveStatusPeriod({ mode: "range" }, ctx).mode).toBe("all");
  });
});
