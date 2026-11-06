import { describe, it, expect } from "vitest";
import { describeShareStamp } from "@/lib/weekly-share-view";

const base = { createdAt: "2026-11-03T01:34:00Z", editedAt: null as string | null };

describe("describeShareStamp — 작성자·수정자 표기", () => {
  it("수정이 없으면 '작성자 · 시각'", () => {
    expect(describeShareStamp({ ...base, createdByName: "김서연", updatedByName: "김서연" })).toBe("김서연 · 11/3(화) 10:34");
  });
  it("같은 사람이 고쳤으면 '작성자 · 시각 · 수정됨 시각'", () => {
    expect(
      describeShareStamp({ ...base, editedAt: "2026-11-05T00:10:00Z", createdByName: "김서연", updatedByName: "김서연" }),
    ).toBe("김서연 · 11/3(화) 10:34 · 수정됨 11/5(목) 09:10");
  });
  it("다른 사람이 고쳤으면 작성과 수정을 나눠 보여 준다", () => {
    expect(
      describeShareStamp({ ...base, editedAt: "2026-11-05T00:10:00Z", createdByName: "김서연", updatedByName: "이승준" }),
    ).toBe("작성 김서연 11/3(화) 10:34 · 수정 이승준 11/5(목) 09:10");
  });
  it("작성자 계정이 삭제됐으면 '(삭제된 사용자)'", () => {
    expect(describeShareStamp({ ...base, createdByName: null, updatedByName: null })).toBe("(삭제된 사용자) · 11/3(화) 10:34");
  });
});
