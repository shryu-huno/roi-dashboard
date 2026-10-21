import { describe, it, expect } from "vitest";
import { overlapRatio } from "@/lib/metrics/proration";

// 날짜는 기존 코드(toYm)와 동일하게 로컬 게터로 해석된다. 테스트 환경(KST/UTC)에서
// "YYYY-MM-01"은 해당 월로 안정적으로 매핑된다(기존 task-matrix 테스트와 동일 패턴).
const d = (s: string) => new Date(s);

describe("overlapRatio: 계약기간 월수 균등분배 비율", () => {
  it("연도 전체에 꽉 차는 계약은 1", () => {
    expect(overlapRatio(2026, "all", d("2026-01-01"), d("2026-12-31"))).toBe(1);
  });

  it("두 해에 걸친 4~3월 계약을 달력연도로 쪼갠다", () => {
    // P1 2025-04~2026-03: 2026에는 1~3월 3개월 / 전체 12 = 0.25
    expect(overlapRatio(2026, "all", d("2025-04-01"), d("2026-03-31"))).toBe(3 / 12);
    // 같은 계약의 2025분: 4~12월 9개월 / 12 = 0.75
    expect(overlapRatio(2025, "all", d("2025-04-01"), d("2026-03-31"))).toBe(9 / 12);
    // P2 2026-04~2027-03: 2026에는 4~12월 9개월 / 12 = 0.75
    expect(overlapRatio(2026, "all", d("2026-04-01"), d("2027-03-31"))).toBe(9 / 12);
  });

  it("겹치지 않으면 0", () => {
    expect(overlapRatio(2025, "all", d("2026-04-01"), d("2027-03-31"))).toBe(0);
    // 단월 선택이 계약 창 밖
    expect(overlapRatio(2026, "5", d("2025-04-01"), d("2026-03-31"))).toBe(0);
  });

  it("계약기간이 선택 창보다 짧으면 창 안에 전부 들어가 1", () => {
    // 계약 2026-01~2026-06(6개월), 연도 전체 선택 → 6/6 = 1
    expect(overlapRatio(2026, "all", d("2026-01-01"), d("2026-06-30"))).toBe(1);
  });

  it("기간 하위필터(반기/분기/단월)를 반영한다", () => {
    // 상반기(1~6월) × 2026-04~2027-03: 4~6월 3개월 / 12 = 0.25
    expect(overlapRatio(2026, "h1", d("2026-04-01"), d("2027-03-31"))).toBe(3 / 12);
    // 2분기(4~6월) × 2026-04~2027-03: 3개월 / 12 = 0.25
    expect(overlapRatio(2026, "q2", d("2026-04-01"), d("2027-03-31"))).toBe(3 / 12);
    // 단월 2월 × 2025-04~2026-03: 2026-02 포함 → 1/12
    expect(overlapRatio(2026, "2", d("2025-04-01"), d("2026-03-31"))).toBe(1 / 12);
  });

  it("계약기간 미설정이면 선택 연도(1~12월)로 간주", () => {
    expect(overlapRatio(2026, "all", null, null)).toBe(1); // 12/12
    expect(overlapRatio(2026, "h1", null, null)).toBe(6 / 12); // 1~6월
    // 한쪽만 설정돼도 폴백(연도 전체)로 처리
    expect(overlapRatio(2026, "all", d("2025-04-01"), null)).toBe(1);
    expect(overlapRatio(2026, "all", null, d("2027-03-31"))).toBe(1);
  });

  it("시작·종료가 뒤집혀도 정렬해서 계산", () => {
    expect(overlapRatio(2026, "all", d("2026-12-31"), d("2026-01-01"))).toBe(1);
  });
});
