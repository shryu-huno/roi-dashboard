// 주간 공유 내부 탭과 역할별 접근.
export type WeeklyTabKey = "batch" | "history" | "status" | "bids";

export type WeeklyTab = { key: WeeklyTabKey; label: string; roles?: readonly string[] }; // roles가 없으면 모든 역할

// 파트 현황·입찰·수주를 보는 역할. 파트장은 파트 현황에서 본인 파트만, 입찰·수주는 보기만 한다.
const VIEW_ROLES = ["SUPER_ADMIN", "ADMIN", "PART_LEADER"] as const;
// 입찰 등록·수정은 최고관리자·팀 관리자만(DB 정책도 같은 규칙).
const BID_EDIT_ROLES = ["SUPER_ADMIN", "ADMIN"] as const;

export const WEEKLY_TABS: readonly WeeklyTab[] = [
  { key: "batch", label: "일지작성" },
  { key: "history", label: "히스토리" },
  { key: "status", label: "파트 현황", roles: VIEW_ROLES },
  { key: "bids", label: "입찰·수주", roles: VIEW_ROLES },
];

const has = (roles: readonly string[], role: string | null | undefined) => !!role && roles.includes(role);

export const canSeeStatusTab = (role: string | null | undefined) => has(VIEW_ROLES, role);
export const canSeeBidsTab = (role: string | null | undefined) => has(VIEW_ROLES, role);
export const canEditBids = (role: string | null | undefined) => has(BID_EDIT_ROLES, role);

export function visibleTabs(role: string | null | undefined): WeeklyTab[] {
  return WEEKLY_TABS.filter((t) => !t.roles || has(t.roles, role));
}
