import { describe, it, expect } from "vitest";
import { withVat, withVatSplit } from "@/lib/vat";

describe("withVat", () => {
  it("returns the raw amount when not included", () => {
    expect(withVat(12345, false)).toBe(12345);
    expect(withVat(0, false)).toBe(0);
  });

  it("applies ×1.1 and rounds to the nearest 10 won (ones digit = 0)", () => {
    expect(withVat(40000, true)).toBe(44000);
    expect(withVat(5000, true)).toBe(5500);
    expect(withVat(12345, true)).toBe(13580); // 13579.5 → 13580
    expect(withVat(1, true)).toBe(0); // 1.1 → 0
    expect(withVat(0, true)).toBe(0);
  });

  it("every VAT-included result ends in 0 won", () => {
    for (const v of [1, 7, 99, 12345, 987654, 1000001]) {
      expect(withVat(v, true) % 10).toBe(0);
    }
  });
});

describe("withVatSplit", () => {
  it("applies ×1.1 to the taxable part only, adds the exempt part raw", () => {
    expect(withVatSplit(40000, 10000, true)).toBe(54000); // 44000 + 10000
    expect(withVatSplit(40000, 10000, false)).toBe(50000); // 원값 합
  });

  it("all-exempt is never grossed up; all-taxable matches withVat", () => {
    expect(withVatSplit(0, 50000, true)).toBe(50000);
    expect(withVatSplit(50000, 0, true)).toBe(withVat(50000, true));
  });
});
