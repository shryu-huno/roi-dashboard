import { describe, it, expect } from "vitest";
import { canEditBids, canSeeBidsTab, canSeeStatusTab, visibleTabs } from "@/app/(app)/weekly-share/tabs";

const keys = (role: string | null) => visibleTabs(role).map((t) => t.key);

describe("주간 공유 탭 — 역할별 노출", () => {
  it("최고관리자·팀 관리자는 모든 탭을 본다", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN"]) expect(keys(role)).toEqual(["batch", "history", "status", "bids"]);
  });
  it("파트장도 파트 현황(본인 파트)과 입찰·수주(보기)까지 본다", () => {
    expect(keys("PART_LEADER")).toEqual(["batch", "history", "status", "bids"]);
    expect(canSeeStatusTab("PART_LEADER")).toBe(true);
    expect(canSeeBidsTab("PART_LEADER")).toBe(true);
  });
  it("PM·정산담당·역할 없음은 일지작성과 히스토리만 본다", () => {
    for (const role of ["PM", "SETTLEMENT", null]) {
      expect(keys(role)).toEqual(["batch", "history"]);
      expect(canSeeStatusTab(role)).toBe(false);
      expect(canSeeBidsTab(role)).toBe(false);
    }
  });
  it("입찰 등록·수정은 최고관리자·팀 관리자만(파트장은 보기만)", () => {
    expect(canEditBids("SUPER_ADMIN")).toBe(true);
    expect(canEditBids("ADMIN")).toBe(true);
    for (const role of ["PART_LEADER", "PM", "SETTLEMENT", null]) expect(canEditBids(role)).toBe(false);
  });
});
