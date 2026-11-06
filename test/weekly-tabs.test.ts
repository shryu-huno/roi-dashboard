import { describe, it, expect } from "vitest";
import { canSeeAdminTabs, visibleTabs } from "@/app/(app)/weekly-share/tabs";

const keys = (role: string | null) => visibleTabs(role).map((t) => t.key);

describe("주간 공유 탭 — 관리자 전용 탭 노출", () => {
  it("최고관리자·팀 관리자는 파트 현황과 입찰·수주까지 본다", () => {
    expect(keys("SUPER_ADMIN")).toEqual(["batch", "history", "status", "bids"]);
    expect(keys("ADMIN")).toEqual(["batch", "history", "status", "bids"]);
    expect(canSeeAdminTabs("ADMIN")).toBe(true);
  });
  it("PM·파트장·정산담당·역할 없음은 주간 공유와 히스토리만 본다", () => {
    for (const role of ["PM", "PART_LEADER", "SETTLEMENT", null]) {
      expect(keys(role)).toEqual(["batch", "history"]);
      expect(canSeeAdminTabs(role)).toBe(false);
    }
  });
});
