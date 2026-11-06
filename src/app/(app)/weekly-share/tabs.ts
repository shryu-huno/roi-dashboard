// 주간 공유 내부 탭. 히스토리·파트 현황·입찰·수주 탭은 각 단계에서 이 목록에 추가한다.
export type WeeklyTabKey = "batch";

export type WeeklyTab = { key: WeeklyTabKey; label: string };

export const WEEKLY_TABS: readonly WeeklyTab[] = [{ key: "batch", label: "주간 공유" }];
