import { describe, it, expect } from "vitest";
import { canAccessExpenseTab, visibleExpenseTabs, DEFAULT_EXPENSE_TAB } from "@/app/(app)/expenses/tabs";

describe("지급 리스트 탭 PM 접근", () => {
  it("PM도 payment-list 탭에 접근 가능하다", () => {
    expect(canAccessExpenseTab("PM", "payment-list")).toBe(true);
  });
  it("PM의 visibleExpenseTabs에 payment-list가 포함된다", () => {
    const keys = visibleExpenseTabs("PM").map((t) => t.key);
    expect(keys).toContain("payment-list");
  });
  it("ADMIN/SETTLEMENT는 기존과 동일하게 접근 가능하다", () => {
    expect(canAccessExpenseTab("ADMIN", "payment-list")).toBe(true);
    expect(canAccessExpenseTab("SETTLEMENT", "payment-list")).toBe(true);
  });
  it("기본 탭은 변경되지 않는다", () => {
    expect(DEFAULT_EXPENSE_TAB).toBe("all");
  });
});
