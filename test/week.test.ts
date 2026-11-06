import { describe, it, expect } from "vitest";
import {
  weekStartOf, addWeeks, prevWeek, weekEnd, isWeekStart,
  weeksOverlappingMonth, weekMonth, weekLabel, weekRange, kstToday, currentWeek,
} from "@/lib/week";

describe("weekStartOf — 주는 일요일 시작, 키는 그 주 일요일", () => {
  it("일요일은 자기 자신이다", () => {
    expect(weekStartOf("2026-11-01")).toBe("2026-11-01");
  });
  it("주중·토요일은 직전 일요일이다", () => {
    expect(weekStartOf("2026-11-05")).toBe("2026-11-01"); // 목
    expect(weekStartOf("2026-11-07")).toBe("2026-11-01"); // 토
  });
  it("월을 넘어가는 경우도 직전 일요일이다", () => {
    expect(weekStartOf("2026-12-01")).toBe("2026-11-29"); // 화
  });
  it("연을 넘어가는 경우도 직전 일요일이다", () => {
    expect(weekStartOf("2027-01-01")).toBe("2026-12-27"); // 금
  });
});

describe("addWeeks / prevWeek / weekEnd", () => {
  it("주 단위로 이동한다", () => {
    expect(addWeeks("2026-11-01", 1)).toBe("2026-11-08");
    expect(addWeeks("2026-11-01", -2)).toBe("2026-10-18");
  });
  it("prevWeek는 한 주 전이다", () => {
    expect(prevWeek("2026-11-01")).toBe("2026-10-25");
  });
  it("weekEnd는 그 주 토요일이다", () => {
    expect(weekEnd("2026-11-01")).toBe("2026-11-07");
    expect(weekEnd("2026-11-29")).toBe("2026-12-05");
  });
});

describe("isWeekStart — 저장 키 검증", () => {
  it("일요일 날짜만 true", () => {
    expect(isWeekStart("2026-11-01")).toBe(true);
    expect(isWeekStart("2026-11-02")).toBe(false); // 월요일
  });
  it("형식이 틀리거나 없는 날짜는 false", () => {
    expect(isWeekStart("2026-1-1")).toBe(false);
    expect(isWeekStart("2026-02-30")).toBe(false);
    expect(isWeekStart("")).toBe(false);
  });
});

describe("weeksOverlappingMonth — 그 달과 하루라도 겹치는 주(걸친 주는 두 달 모두)", () => {
  it("11월: 1일이 일요일이라 11/1 주부터, 11/29 주까지", () => {
    expect(weeksOverlappingMonth(2026, 11)).toEqual([
      "2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29",
    ]);
  });
  it("10월: 9/27 주(10/1이 목요일)부터 10/25 주까지", () => {
    expect(weeksOverlappingMonth(2026, 10)).toEqual([
      "2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25",
    ]);
  });
  it("걸친 주(11/29~12/5)는 11월과 12월 양쪽에 나온다", () => {
    expect(weeksOverlappingMonth(2026, 11)).toContain("2026-11-29");
    expect(weeksOverlappingMonth(2026, 12)).toContain("2026-11-29");
  });
  it("2월(28일)은 4~5주", () => {
    expect(weeksOverlappingMonth(2026, 2)).toEqual([
      "2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22",
    ]);
  });
});

describe("weekMonth / weekLabel / weekRange — 걸친 주의 소속 월은 4일 이상 걸친 달", () => {
  it("11/29 주(11/29~12/5)는 12월 소속, 12월 1주차", () => {
    expect(weekMonth("2026-11-29")).toEqual({ year: 2026, month: 12 });
    expect(weekLabel("2026-11-29")).toBe("12월 1주차");
  });
  it("9/27 주는 9월 소속, 9월 5주차", () => {
    expect(weekMonth("2026-09-27")).toEqual({ year: 2026, month: 9 });
    expect(weekLabel("2026-09-27")).toBe("9월 5주차");
  });
  it("11/1 주는 11월 1주차", () => {
    expect(weekLabel("2026-11-01")).toBe("11월 1주차");
    expect(weekLabel("2026-11-08")).toBe("11월 2주차");
  });
  it("연을 넘는 주는 4일 이상 걸친 해로 소속된다", () => {
    expect(weekMonth("2026-12-27")).toEqual({ year: 2026, month: 12 }); // 12/27~1/2: 12월이 4일(일~수)
    expect(weekMonth("2024-12-29")).toEqual({ year: 2025, month: 1 }); // 12/29~1/4: 1월이 4일(수~토)
    expect(weekLabel("2024-12-29")).toBe("1월 1주차");
  });
  it("범위 문구", () => {
    expect(weekRange("2026-11-01")).toBe("11/1–11/7");
    expect(weekRange("2026-11-29")).toBe("11/29–12/5");
  });
});

describe("kstToday / currentWeek — 한국 시간 기준", () => {
  it("UTC로는 아직 전날이어도 한국 날짜를 쓴다", () => {
    // 2026-11-06 20:00 UTC = 2026-11-07 05:00 KST(토)
    expect(kstToday(new Date("2026-11-06T20:00:00Z"))).toBe("2026-11-07");
    expect(currentWeek(new Date("2026-11-06T20:00:00Z"))).toBe("2026-11-01");
  });
  it("한국 기준 일요일 새벽이면 새 주로 넘어간다", () => {
    // 2026-11-07 16:00 UTC = 2026-11-08 01:00 KST(일)
    expect(currentWeek(new Date("2026-11-07T16:00:00Z"))).toBe("2026-11-08");
  });
});
