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
    expect(expenseCategoryLabel("COUNSELING_FEE")).toBe("상담료");
    expect(expenseCategoryLabel("INSTRUCTOR_FEE")).toBe("강사료");
    expect(expenseCategoryLabel("PROMOTION")).toBe("홍보비용");
    expect(expenseCategoryLabel("ETC")).toBe("기타");
  });
});
