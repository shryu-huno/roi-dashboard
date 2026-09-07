export type AppRole = "SUPER_ADMIN" | "ADMIN" | "PART_LEADER" | "SETTLEMENT" | "PM";

// 조직 계층 순위. 단, "전체 접근" 여부는 순위로 표현하지 않는다(정산담당자는 순위가 낮아도
// 전체 열람이므로). 순위는 requireRole("PM")처럼 "≥ PM = 승인된 사용자" 판정에만 쓴다.
// 파트장(PART_LEADER)은 팀 관리자 아래·PM 위. requireRole("ADMIN")(고객사 보관/삭제)에는 못 미치고,
// requireRole("PM")(승인된 사용자)는 통과한다. 값은 순서만 의미가 있다.
const RANK: Record<AppRole, number> = { SUPER_ADMIN: 5, ADMIN: 4, PART_LEADER: 3, SETTLEMENT: 2, PM: 1 };

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

/** 파트장(자기에게 소속된 PM이 담당하는 고객사만 열람·관리). */
export function isPartLeader(role: AppRole | null | undefined): boolean {
  return role === "PART_LEADER";
}

/**
 * 팀/파트 단위로 스코프된 관리자(자기 범위 내 PM 배정·고객사/데이터 관리 가능).
 * 실제 범위 제한은 RLS(ClientManager/ProjectManager WITH CHECK)가 강제한다.
 */
export function isTeamScoped(role: AppRole | null | undefined): boolean {
  return isTeamAdmin(role) || isPartLeader(role);
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
