import type { AppRole } from "@/lib/auth/rbac";

export type ExpenseTabKey = "all" | "payment-list";

export type ExpenseTab = {
  key: ExpenseTabKey;
  label: string;
  roles: readonly AppRole[];
};

export const EXPENSE_TABS: readonly ExpenseTab[] = [
  { key: "all", label: "전체 내역", roles: ["ADMIN", "SETTLEMENT", "PM"] },
  { key: "payment-list", label: "지급 리스트", roles: ["ADMIN", "SETTLEMENT"] },
];

export const DEFAULT_EXPENSE_TAB: ExpenseTabKey = "all";

// 역할이 볼 수 있는 탭 목록 (탭바 렌더용).
export function visibleExpenseTabs(role: AppRole): readonly ExpenseTab[] {
  return EXPENSE_TABS.filter((tab) => tab.roles.includes(role));
}

// 역할이 특정 탭에 접근 가능한지 (직접 URL 접근 차단용).
// 알 수 없는 탭 문자열, 또는 유효하지만 권한 없는 탭이면 false.
export function canAccessExpenseTab(role: AppRole, tab: string): boolean {
  const found = EXPENSE_TABS.find((t) => t.key === tab);
  return found ? found.roles.includes(role) : false;
}
