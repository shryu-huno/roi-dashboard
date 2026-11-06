import { describe, it, expect } from "vitest";
import { addMonths } from "@/lib/month-range";

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
