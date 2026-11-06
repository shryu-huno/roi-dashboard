// 주간 공유 내부 탭. 입찰·수주 탭은 해당 단계에서 이 목록에 추가한다.
export type WeeklyTabKey = "batch" | "history" | "status";

export type WeeklyTab = { key: WeeklyTabKey; label: string; adminOnly?: boolean };

export const WEEKLY_TABS: readonly WeeklyTab[] = [
  { key: "batch", label: "주간 공유" },
  { key: "history", label: "히스토리" },
  { key: "status", label: "파트 현황", adminOnly: true },
];

/** 파트 현황·입찰·수주는 관리자(최고관리자·팀 관리자)만. 파트장은 이번 범위에서 제외한다. */
export function canSeeAdminTabs(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export function visibleTabs(role: string | null | undefined): WeeklyTab[] {
  return WEEKLY_TABS.filter((t) => !t.adminOnly || canSeeAdminTabs(role));
}
