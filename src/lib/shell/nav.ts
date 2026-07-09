import type { AppRole } from "@/lib/auth/rbac";

export type NavItem = { href: string; label: string };

export function navItemsForRole(role: AppRole | null): NavItem[] {
  const items: NavItem[] = [
    { href: "/clients", label: "고객사 목록" },
    { href: "/performance", label: "실적 입력" },
  ];
  if (role === "SETTLEMENT" || role === "ADMIN") {
    items.push({ href: "/expenses", label: "지출 입력" });
    items.push({ href: "/billing", label: "청구·입금 입력" });
    items.push({ href: "/settings/clients", label: "설정" });
  }
  if (role === "ADMIN") items.push({ href: "/admin/users", label: "사용자 관리" });
  return items;
}
