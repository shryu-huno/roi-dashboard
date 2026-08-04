import { describe, it, expect } from "vitest";
import { buildPaymentRequestRegistrationRowsFromXlsx, REGISTRATION_TEMPLATE_HEADERS } from "@/lib/data/payment-request-registration-upload";

const HEADER = [...REGISTRATION_TEMPLATE_HEADERS];

function fullRow(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    "지급명의": "휴노", "고객사명": "A사", "사업자명(이름)": "", "고유번호": "a001",
    "연락처": "", "사업자번호(주민등록번호)": "", "은행명": "", "계좌번호": "", "예금주": "",
    "단가": "10000", "교통비": "0", "재료비": "0", "횟수": "1", "청구방식": "", "상세내역": "메모",
    ...overrides,
  };
  return REGISTRATION_TEMPLATE_HEADERS.map((h) => base[h]);
}

describe("buildPaymentRequestRegistrationRowsFromXlsx", () => {
  it("고유번호가 있는 연동 행을 파싱한다 — 사업자명/청구방식은 null로 무시 표시", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow()]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{
      row: 2,
      data: {
        entity: "HUNO", clientName: "A사", bizNameRaw: "", keyId: "a001", bizNumberDigits: null,
        taxTypeRaw: null, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "메모",
      },
    }]);
  });

  it("사업자번호만 있는 연동 행도 파싱한다(고유번호 공란)", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자번호(주민등록번호)": "1234567890" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].data.keyId).toBeNull();
    expect(result.rows[0].data.bizNumberDigits).toBe("1234567890");
    expect(result.rows[0].data.taxTypeRaw).toBeNull();
  });

  it("고유번호·사업자번호가 둘 다 없는 예외 행은 사업자명/청구방식을 그대로 보존한다", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자명(이름)": "홍길동", "청구방식": "세금계산서" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].data.keyId).toBeNull();
    expect(result.rows[0].data.bizNumberDigits).toBeNull();
    expect(result.rows[0].data.bizNameRaw).toBe("홍길동");
    expect(result.rows[0].data.taxTypeRaw).toBe("세금계산서");
  });

  it("예외 행인데 사업자명이 없으면 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자명(이름)": "", "청구방식": "세금계산서" }),
    ]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
  });

  it("예외 행인데 청구방식이 없으면 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자명(이름)": "홍길동", "청구방식": "" }),
    ]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("지급명의 값이 잘못되면 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "지급명의": "다른회사" })]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("사업자번호 형식이 잘못되면(9자리) 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자번호(주민등록번호)": "123456789" }),
    ]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("단가/횟수가 0 이하면 오류", () => {
    expect(buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "단가": "0" })]).errors).toHaveLength(1);
    expect(buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "횟수": "0" })]).errors).toHaveLength(1);
  });

  it("교통비/재료비가 공란이면 0으로 처리된다", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "교통비": "", "재료비": "" })]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].data.transportFee).toBe(0);
    expect(result.rows[0].data.materialFee).toBe(0);
  });

  it("완전히 빈 행은 건너뛴다", () => {
    const blank = REGISTRATION_TEMPLATE_HEADERS.map(() => "");
    const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, blank, fullRow()]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].row).toBe(3);
  });

  it("헤더 누락 시 전체 오류", () => {
    const badHeader = HEADER.filter((h) => h !== "고유번호");
    const result = buildPaymentRequestRegistrationRowsFromXlsx([badHeader]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 0, message: "헤더 누락: 고유번호" }]);
  });

  it("빈 파일이면 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([]);
    expect(result.errors).toEqual([{ row: 0, message: "빈 파일입니다." }]);
  });

  it("여러 행 중 일부만 오류여도 나머지는 정상 파싱된다", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER,
      fullRow(),
      fullRow({ "지급명의": "다른회사" }),
      fullRow({ "고유번호": "b002" }),
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.row)).toEqual([2, 4]);
    expect(result.errors).toEqual([{ row: 3, message: expect.any(String) }]);
  });
});
