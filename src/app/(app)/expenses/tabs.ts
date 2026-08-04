import type { AppRole } from "@/lib/auth/rbac";

export type ExpenseTabKey =
  | "all"
  | "payment-list"
  | "payment-request"
  | "consulting"
  | "corporate-card"
  | "personal-card"
  | "promotion"
  | "hipass";

export type ExpenseTab = {
  key: ExpenseTabKey;
  label: string;
  // 이 탭 전체를 볼 수 있는 역할(관리자·정산담당자). PM은 여기 넣지 않는다.
  roles: readonly AppRole[];
  // PM이 담당 고객사 범위로 접근 가능한 탭. 데이터는 DB RLS가 담당 고객사로 제한한다.
  pmScoped?: boolean;
};

export const EXPENSE_TABS: readonly ExpenseTab[] = [
  { key: "all", label: "메뉴얼", roles: ["ADMIN", "SETTLEMENT"], pmScoped: true },
  // 지급 리스트는 고객사 구분이 없는 전사 공용 원장이라 PM에 열지 않는다(전 지급 대상 노출 방지).
  { key: "payment-list", label: "지급 리스트", roles: ["ADMIN", "SETTLEMENT"] },
  { key: "payment-request", label: "지급 요청", roles: ["ADMIN", "SETTLEMENT"], pmScoped: true },
  { key: "consulting", label: "상담비", roles: ["ADMIN", "SETTLEMENT"], pmScoped: true },
  { key: "corporate-card", label: "법인카드", roles: ["ADMIN", "SETTLEMENT"], pmScoped: true },
  { key: "personal-card", label: "개인카드", roles: ["ADMIN", "SETTLEMENT"], pmScoped: true },
  { key: "promotion", label: "홍보비", roles: ["ADMIN", "SETTLEMENT"], pmScoped: true },
  { key: "hipass", label: "하이패스", roles: ["ADMIN", "SETTLEMENT"], pmScoped: true },
];

export const DEFAULT_EXPENSE_TAB: ExpenseTabKey = "all";

// 역할이 특정 탭에 접근 가능한지 판정 (공용 헬퍼).
// 관리자·정산담당자는 roles로, PM은 pmScoped 탭에 한해 허용(데이터는 RLS가 담당 고객사로 제한).
function roleCanAccess(role: AppRole, tab: ExpenseTab): boolean {
  if (tab.roles.includes(role)) return true;
  return role === "PM" && tab.pmScoped === true;
}

// 역할이 볼 수 있는 탭 목록 (탭바 렌더용).
export function visibleExpenseTabs(role: AppRole): readonly ExpenseTab[] {
  return EXPENSE_TABS.filter((tab) => roleCanAccess(role, tab));
}

// 역할이 특정 탭에 접근 가능한지 (직접 URL 접근 차단용).
// 알 수 없는 탭 문자열, 또는 유효하지만 권한 없는 탭이면 false.
export function canAccessExpenseTab(role: AppRole, tab: string): boolean {
  const found = EXPENSE_TABS.find((t) => t.key === tab);
  return found ? roleCanAccess(role, found) : false;
}
