import { describe, it, expect } from "vitest";
import { withVat } from "@/lib/vat";

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
