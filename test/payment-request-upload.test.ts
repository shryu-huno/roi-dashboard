import { describe, it, expect } from "vitest";
import { buildPaymentRequestUpdatesFromRows } from "@/lib/data/payment-request-upload";

const HEADER = ["No", "지급일", "지급여부"];

describe("buildPaymentRequestUpdatesFromRows", () => {
  it("정상 행을 파싱한다", () => {
    const result = buildPaymentRequestUpdatesFromRows([
      HEADER,
      ["1", "2026-08-05", "지급완료"],
      ["2", "", "지급준비"],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.updates).toEqual([
      { row: 2, seqNo: 1, payDate: new Date("2026-08-05T00:00:00.000Z"), status: "COMPLETED" },
      { row: 3, seqNo: 2, payDate: null, status: "PREPARING" },
    ]);
  });

  it("No가 정수가 아니면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["abc", "2026-08-05", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: "No 값이 올바르지 않습니다." }]);
  });

  it("No가 공란이면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["", "2026-08-05", "지급완료"]]);
    expect(result.errors).toEqual([{ row: 2, message: "No 값이 올바르지 않습니다." }]);
  });

  it("지급여부가 지급준비/지급완료가 아니면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2026-08-05", "완료함"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급여부");
  });

  it("지급완료인데 지급일이 공란이면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: "지급완료 처리하려면 지급일을 입력해야 합니다." }]);
  });

  it("지급준비인데 지급일이 공란이면 정상 처리(공란 허용)", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "", "지급준비"]]);
    expect(result.errors).toEqual([]);
    expect(result.updates).toEqual([{ row: 2, seqNo: 1, payDate: null, status: "PREPARING" }]);
  });

  it("지급일 형식이 YYYY-MM-DD가 아니면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2026/08/05", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급일 형식");
  });

  it("완전히 빈 행은 건너뛴다", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["", "", ""], ["1", "", "지급준비"]]);
    expect(result.updates).toEqual([{ row: 3, seqNo: 1, payDate: null, status: "PREPARING" }]);
    expect(result.errors).toEqual([]);
  });

  it("헤더 누락 시 전체 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([["No", "지급여부"], ["1", "지급준비"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors).toEqual([{ row: 0, message: "헤더 누락: 지급일" }]);
  });

  it("빈 파일이면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([]);
    expect(result.errors).toEqual([{ row: 0, message: "빈 파일입니다." }]);
  });

  it("여러 행 중 일부만 오류여도 나머지는 정상 반환된다", () => {
    const result = buildPaymentRequestUpdatesFromRows([
      HEADER,
      ["1", "2026-08-05", "지급완료"],
      ["abc", "2026-08-05", "지급완료"],
      ["2", "", "지급준비"],
    ]);
    expect(result.updates).toHaveLength(2);
    expect(result.errors).toEqual([{ row: 3, message: "No 값이 올바르지 않습니다." }]);
  });

  // 달력 유효성 검증 (회귀 테스트)
  it("달력상 유효하지 않은 날짜 2026-02-30은 거부한다", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2026-02-30", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급일 형식");
  });

  it("달력상 유효하지 않은 날짜 2026-04-31은 거부한다", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2026-04-31", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급일 형식");
  });

  it("평년의 2월 29일(2001-02-29)은 거부한다", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2001-02-29", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급일 형식");
  });

  it("윤년의 2월 29일(2024-02-29)은 정상 처리한다", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2024-02-29", "지급완료"]]);
    expect(result.errors).toEqual([]);
    expect(result.updates).toEqual([
      { row: 2, seqNo: 1, payDate: new Date("2024-02-29T00:00:00.000Z"), status: "COMPLETED" },
    ]);
  });

  it("2026-11-31(11월 31일)은 거부한다", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2026-11-31", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급일 형식");
  });
});
