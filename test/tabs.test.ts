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
  it("전체 접근(최고관리자·정산담당자)은 지급 리스트에 접근 가능하다", () => {
    expect(canAccessExpenseTab("SUPER_ADMIN", "payment-list")).toBe(true);
    expect(canAccessExpenseTab("SETTLEMENT", "payment-list")).toBe(true);
  });
  it("팀 관리자는 전역 원장 탭(지급 리스트·지급 요청)에서 제외된다", () => {
    expect(canAccessExpenseTab("ADMIN", "payment-list")).toBe(false);
    expect(canAccessExpenseTab("ADMIN", "payment-request")).toBe(false);
  });
  it("팀 관리자는 고객사 스코프 지출 탭(상담비·법인카드)에는 접근 가능하다", () => {
    expect(canAccessExpenseTab("ADMIN", "consulting")).toBe(true);
    expect(canAccessExpenseTab("ADMIN", "corporate-card")).toBe(true);
  });
  it("기본 탭은 변경되지 않는다", () => {
    expect(DEFAULT_EXPENSE_TAB).toBe("all");
  });
});
