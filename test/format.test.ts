import { describe, it, expect } from "vitest";
import { formatWon, formatPercent, formatThousands } from "@/lib/format";

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
