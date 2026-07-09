import { describe, it, expect } from "vitest";
import { roleLabel, statusLabel, expenseCategoryLabel } from "@/lib/labels";

describe("labels", () => {
  it("maps roles to Korean", () => {
    expect(roleLabel("ADMIN")).toBe("관리자");
    expect(roleLabel("SETTLEMENT")).toBe("정산담당자");
    expect(roleLabel("PM")).toBe("PM");
    expect(roleLabel(null)).toBe("미지정");
  });
  it("maps status to Korean", () => {
    expect(statusLabel("PENDING")).toBe("승인대기");
    expect(statusLabel("ACTIVE")).toBe("활성");
    expect(statusLabel("INACTIVE")).toBe("비활성");
  });
  it("maps expense categories to Korean", () => {
    expect(expenseCategoryLabel("CORPORATE_CARD")).toBe("법인카드");
    expect(expenseCategoryLabel("PERSONAL_CARD")).toBe("개인카드");
    expect(expenseCategoryLabel("LABOR_COUNSELOR")).toBe("인건비(상담사)");
    expect(expenseCategoryLabel("LABOR_INSTRUCTOR")).toBe("인건비(강사)");
    expect(expenseCategoryLabel("EDUCATION_PROGRAM")).toBe("교육&프로그램 진행비");
    expect(expenseCategoryLabel("PROMOTION_OFFLINE")).toBe("홍보비(오프라인)");
    expect(expenseCategoryLabel("PROMOTION_EVENT")).toBe("홍보비(이벤트)");
    expect(expenseCategoryLabel("OPS_TRANSPORT")).toBe("운영비(교통비)");
    expect(expenseCategoryLabel("OPS_LODGING")).toBe("운영비(숙박비)");
    expect(expenseCategoryLabel("OPS_FOOD")).toBe("운영비(식비)");
    expect(expenseCategoryLabel("OPS_MEETING")).toBe("운영비(회의비)");
    expect(expenseCategoryLabel("TEST_MATERIAL")).toBe("검사지 구매");
    expect(expenseCategoryLabel("GENERAL_ETC")).toBe("일반관리(기타)");
  });
});
