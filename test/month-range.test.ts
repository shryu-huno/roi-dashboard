import { describe, it, expect } from "vitest";
import { addMonths, parseYearInput, parseMonthInput, clampYm, YEAR_MIN, YEAR_MAX } from "@/lib/month-range";

describe("addMonths", () => {
  it("같은 해 안에서 한 달 앞뒤로 이동한다", () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2026, month: 12 });
    expect(addMonths({ year: 2026, month: 11 }, -1)).toEqual({ year: 2026, month: 10 });
  });

  it("12월에서 다음 달은 다음 해 1월이다", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("1월에서 이전 달은 작년 12월이다", () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("여러 달·여러 해를 한 번에 이동한다", () => {
    expect(addMonths({ year: 2026, month: 3 }, -15)).toEqual({ year: 2024, month: 12 });
    expect(addMonths({ year: 2026, month: 3 }, 25)).toEqual({ year: 2028, month: 4 });
  });

  it("0이면 그대로다", () => {
    expect(addMonths({ year: 2026, month: 6 }, 0)).toEqual({ year: 2026, month: 6 });
  });
});

describe("parseYearInput — 직접 입력한 연도", () => {
  it("숫자 또는 '2026년' 형태를 받는다(앞뒤 공백 무시)", () => {
    expect(parseYearInput("2026")).toBe(2026);
    expect(parseYearInput(" 2027년 ")).toBe(2027);
  });
  it("범위(YEAR_MIN~YEAR_MAX)를 벗어나면 null", () => {
    expect(parseYearInput(String(YEAR_MIN))).toBe(YEAR_MIN);
    expect(parseYearInput(String(YEAR_MAX))).toBe(YEAR_MAX);
    expect(parseYearInput(String(YEAR_MIN - 1))).toBeNull();
    expect(parseYearInput(String(YEAR_MAX + 1))).toBeNull();
  });
  it("숫자가 아니거나 비어 있으면 null", () => {
    expect(parseYearInput("")).toBeNull();
    expect(parseYearInput("abc")).toBeNull();
    expect(parseYearInput("20.5")).toBeNull();
    expect(parseYearInput("-2026")).toBeNull();
  });
});

describe("parseMonthInput — 직접 입력한 월", () => {
  it("1~12 숫자 또는 '11월' 형태를 받는다", () => {
    expect(parseMonthInput("1")).toBe(1);
    expect(parseMonthInput("11")).toBe(11);
    expect(parseMonthInput(" 12월 ")).toBe(12);
    expect(parseMonthInput("07")).toBe(7);
  });
  it("0·13 이상·숫자 아님은 null", () => {
    expect(parseMonthInput("0")).toBeNull();
    expect(parseMonthInput("13")).toBeNull();
    expect(parseMonthInput("")).toBeNull();
    expect(parseMonthInput("월")).toBeNull();
    expect(parseMonthInput("1.5")).toBeNull();
  });
});

describe("clampYm — 이동 범위 안으로 맞추기", () => {
  const min = { year: 2026, month: 9 };
  const max = { year: 2026, month: 11 };
  it("범위 안이면 그대로", () => {
    expect(clampYm({ year: 2026, month: 10 }, min, max)).toEqual({ year: 2026, month: 10 });
  });
  it("최대보다 뒤면 최대로, 최소보다 앞이면 최소로", () => {
    expect(clampYm({ year: 2026, month: 12 }, min, max)).toEqual(max);
    expect(clampYm({ year: 2027, month: 1 }, min, max)).toEqual(max);
    expect(clampYm({ year: 2026, month: 8 }, min, max)).toEqual(min);
    expect(clampYm({ year: 2020, month: 5 }, min, max)).toEqual(min);
  });
  it("범위가 해를 넘어도 동작한다", () => {
    const lo = { year: 2025, month: 11 };
    const hi = { year: 2026, month: 2 };
    expect(clampYm({ year: 2026, month: 1 }, lo, hi)).toEqual({ year: 2026, month: 1 });
    expect(clampYm({ year: 2025, month: 10 }, lo, hi)).toEqual(lo);
  });
});
