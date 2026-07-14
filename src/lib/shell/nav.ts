import type { AppRole } from "@/lib/auth/rbac";

export type NavItem = { href: string; label: string };

export function navItemsForRole(role: AppRole | null): NavItem[] {
  const items: NavItem[] = [];
  // 대시보드는 역할이 부여된(승인된) 사용자에게만. getRlsContext는 role null이면 throw.
  if (role) items.push({ href: "/dashboard", label: "전체 현황" });
  items.push({ href: "/clients", label: "고객사 목록" });
  items.push({ href: "/performance", label: "실적 입력" });
  // 실적·지출·청구/입금 입력은 역할이 부여된 사용자 모두. RLS가 담당 고객사로 범위 제한.
  if (role) {
    items.push({ href: "/expenses", label: "지출 입력" });
    items.push({ href: "/billing", label: "청구·입금 입력" });
  }
  // 고객사 설정: 정산담당자/관리자는 전체 고객사, PM은 배정받은 고객사만(RLS로 범위 제한).
  if (role) {
    items.push({ href: "/settings/clients", label: "고객사 설정" });
  }
  if (role === "ADMIN") items.push({ href: "/admin/users", label: "사용자 관리" });
  return items;
}
