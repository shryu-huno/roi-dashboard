import { describe, it, expect } from "vitest";
import { resolvePeriod, normalizePeriod, parsePeriodParams } from "@/lib/period";

describe("resolvePeriod", () => {
  it("maps ranges", () => {
    expect(resolvePeriod("all")).toEqual({ startMonth: 1, endMonth: 12 });
    expect(resolvePeriod("h1")).toEqual({ startMonth: 1, endMonth: 6 });
    expect(resolvePeriod("h2")).toEqual({ startMonth: 7, endMonth: 12 });
    expect(resolvePeriod("3")).toEqual({ startMonth: 3, endMonth: 3 });
    expect(resolvePeriod("12")).toEqual({ startMonth: 12, endMonth: 12 });
  });
  it("falls back to all on invalid", () => {
    expect(resolvePeriod("bogus")).toEqual({ startMonth: 1, endMonth: 12 });
    expect(resolvePeriod("0")).toEqual({ startMonth: 1, endMonth: 12 });
    expect(resolvePeriod("13")).toEqual({ startMonth: 1, endMonth: 12 });
  });
});

describe("normalizePeriod", () => {
  it("keeps valid keys, defaults others to all", () => {
    expect(normalizePeriod("h1")).toBe("h1");
    expect(normalizePeriod("5")).toBe("5");
    expect(normalizePeriod(undefined)).toBe("all");
    expect(normalizePeriod("99")).toBe("all");
  });
});

describe("parsePeriodParams", () => {
  it("uses fallback year when missing/out of range", () => {
    expect(parsePeriodParams({}, 2026)).toEqual({ year: 2026, period: "all" });
    expect(parsePeriodParams({ year: "1999" }, 2026)).toEqual({ year: 2026, period: "all" });
    expect(parsePeriodParams({ year: "2025", period: "h2" }, 2026)).toEqual({ year: 2025, period: "h2" });
  });
});
