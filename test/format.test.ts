import { describe, it, expect } from "vitest";
import { formatWon, formatPercent, formatThousands, formatWonCompact } from "@/lib/format";

describe("formatWon", () => {
  it("formats integer won with suffix", () => {
    expect(formatWon(1000000)).toBe("1,000,000원");
    expect(formatWon(0)).toBe("0원");
  });
  it("renders dash for null/undefined", () => {
    expect(formatWon(null)).toBe("—");
    expect(formatWon(undefined)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("formats ratio to one decimal percent", () => {
    expect(formatPercent(0.7)).toBe("70.0%");
    expect(formatPercent(-0.5)).toBe("-50.0%");
  });
  it("renders dash for null/undefined", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });
});

describe("formatThousands (기존 유지)", () => {
  it("still works", () => {
    expect(formatThousands(1000000)).toBe("1,000,000");
  });
});

describe("formatWonCompact — 차트 축·막대 위 금액 줄임 표기", () => {
  it("1억 이상은 억 단위(소수 1자리, .0은 생략)", () => {
    expect(formatWonCompact(150_000_000)).toBe("1.5억");
    expect(formatWonCompact(100_000_000)).toBe("1억");
    expect(formatWonCompact(1_234_000_000)).toBe("12.3억");
  });
  it("1억 미만은 만 단위(천단위 콤마, 반올림)", () => {
    expect(formatWonCompact(12_345_678)).toBe("1,235만");
    expect(formatWonCompact(50_000)).toBe("5만");
    expect(formatWonCompact(9_999)).toBe("1만");
  });
  it("0은 '0'", () => {
    expect(formatWonCompact(0)).toBe("0");
  });
});
