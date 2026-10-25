import { describe, it, expect } from "vitest";
import { yearSpan, latestProjectSpan } from "@/lib/clients/project-span";

describe("yearSpan", () => {
  it("같은 해면 s", () => {
    expect(yearSpan(new Date("2026-05-01"), new Date("2026-12-31"))).toBe("s");
  });
  it("해를 넘기면 m", () => {
    expect(yearSpan(new Date("2026-05-01"), new Date("2027-04-30"))).toBe("m");
  });
  it("yyyy-mm-dd 문자열도 처리", () => {
    expect(yearSpan("2026-05-01", "2026-04-30")).toBe("s");
    expect(yearSpan("2025-05-01", "2026-04-30")).toBe("m");
  });
  it("시작/종료일이 하나라도 없으면 null", () => {
    expect(yearSpan(null, new Date("2026-12-31"))).toBeNull();
    expect(yearSpan(new Date("2026-05-01"), null)).toBeNull();
    expect(yearSpan(null, null)).toBeNull();
  });
});

describe("latestProjectSpan", () => {
  it("프로젝트 없으면 null", () => {
    expect(latestProjectSpan([])).toBeNull();
  });
  it("계약 시작일이 가장 최신인 프로젝트 기준", () => {
    const projects = [
      { contractStart: new Date("2024-01-01"), contractEnd: new Date("2024-12-31"), createdAt: new Date("2024-01-01") },
      { contractStart: new Date("2026-05-01"), contractEnd: new Date("2027-04-30"), createdAt: new Date("2026-01-01") },
    ];
    expect(latestProjectSpan(projects)).toBe("m");
  });
  it("시작일 없는 프로젝트는 뒤로, 등록일 최신으로 tiebreak", () => {
    const projects = [
      { contractStart: null, contractEnd: null, createdAt: new Date("2026-06-01") },
      { contractStart: new Date("2025-03-01"), contractEnd: new Date("2025-08-31"), createdAt: new Date("2025-01-01") },
    ];
    expect(latestProjectSpan(projects)).toBe("s");
  });
  it("최신 프로젝트에 기간이 없으면 null", () => {
    const projects = [
      { contractStart: null, contractEnd: null, createdAt: new Date("2026-06-01") },
    ];
    expect(latestProjectSpan(projects)).toBeNull();
  });
});
