export type AppRole = "SUPER_ADMIN" | "ADMIN" | "SETTLEMENT" | "PM";

// 조직 계층 순위. 단, "전체 접근" 여부는 순위로 표현하지 않는다(정산담당자는 순위가 낮아도
// 전체 열람이므로). 순위는 requireRole("PM")처럼 "≥ PM = 승인된 사용자" 판정에만 쓴다.
const RANK: Record<AppRole, number> = { SUPER_ADMIN: 4, ADMIN: 3, SETTLEMENT: 2, PM: 1 };

export function hasAtLeast(
  role: AppRole | null | undefined,
  required: AppRole,
): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[required];
}

/** 팀 구분 없이 전체 데이터에 접근하는 역할(최고관리자·정산담당자). */
export function isAllAccess(role: AppRole | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "SETTLEMENT";
}

/** 팀 관리자(자기 팀 소속 PM이 담당하는 고객사만 열람). */
export function isTeamAdmin(role: AppRole | null | undefined): boolean {
  return role === "ADMIN";
}

export function canManageUsers(role: AppRole | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}

export function canManageTeams(role: AppRole | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}

export function canEditSettlement(role: AppRole | null | undefined): boolean {
  return isAllAccess(role);
}
