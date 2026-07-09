import type { AppRole } from "@/lib/auth/rbac";

export type NavItem = { href: string; label: string };

export function navItemsForRole(role: AppRole | null): NavItem[] {
  const items: NavItem[] = [
    { href: "/clients", label: "고객사 목록" },
    { href: "/performance", label: "실적 입력" },
  ];
  // 실적·지출·청구/입금 입력은 역할이 부여된 사용자(PM/SETTLEMENT/ADMIN) 모두 사용. RLS가 담당 고객사로 범위를 제한한다.
  if (role) {
    items.push({ href: "/expenses", label: "지출 입력" });
    items.push({ href: "/billing", label: "청구·입금 입력" });
  }
  // 고객사·과업·단가 설정은 정산담당자/관리자만.
  if (role === "SETTLEMENT" || role === "ADMIN") {
    items.push({ href: "/settings/clients", label: "설정" });
  }
  if (role === "ADMIN") items.push({ href: "/admin/users", label: "사용자 관리" });
  return items;
}
