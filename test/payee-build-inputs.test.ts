import { describe, it, expect } from "vitest";
import { buildPayeeInputsFromCsv, buildPayeeInputsFromRows } from "@/app/(app)/expenses/payees/build-inputs";
import { decrypt } from "@/lib/crypto/payee-secret";

const HEADER = "이름,사업자번호,연락처,은행,계좌번호,예금주,청구방식";

describe("buildPayeeInputsFromCsv", () => {
  it("업체(10자리)·강사(13자리)를 판별하고 암호화·마스킹·유형을 채운다", () => {
    const csv = [
      HEADER,
      "테스트업체,123-45-67890,010-1111-2222,국민,110-123-456789,대표,세금계산서",
      "김강사,900101-1234567,010-3333-4444,신한,220-1234567890,김강사,사업소득",
    ].join("\r\n");
    const { inputs, errors } = buildPayeeInputsFromCsv(csv);
    expect(errors).toEqual([]);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].payeeType).toBe("VENDOR");
    expect(inputs[0].taxType).toBe("TAX_INVOICE");
    expect(inputs[0].bizNumberMasked).toBe("123-45-6****");
    expect(decrypt(inputs[0].bizNumberEnc)).toBe("1234567890");
    expect(inputs[1].payeeType).toBe("INSTRUCTOR");
    expect(inputs[1].bizNumberMasked).toBe("900101-1******");
  });

  it("형식 오류 행은 errors에 행번호와 함께 수집하고 건너뛴다", () => {
    const csv = [HEADER, "불량,123,010-1,국민,110,대표,세금계산서"].join("\r\n");
    const { inputs, errors } = buildPayeeInputsFromCsv(csv);
    expect(inputs).toHaveLength(0);
    expect(errors[0].row).toBe(2);
  });

  it("헤더 누락은 단일 에러로 반환", () => {
    const { inputs, errors } = buildPayeeInputsFromCsv("이름,연락처\n홍길동,010");
    expect(inputs).toHaveLength(0);
    expect(errors[0].message).toMatch(/헤더 누락/);
  });

  it("빈 데이터 행은 조용히 건너뛴다", () => {
    const csv = [HEADER, ",,,,,,", "테스트업체,123-45-67890,010-1234-5678,국민,1101234567,대표,세금계산서"].join("\n");
    const { inputs, errors } = buildPayeeInputsFromCsv(csv);
    expect(errors).toEqual([]);
    expect(inputs).toHaveLength(1);
  });
});

describe("buildPayeeInputsFromRows 헤더 별칭", () => {
  it("서식 라벨(사업자명(이름)/은행명/사업자번호(주민등록번호))을 인식한다", () => {
    const rows = [
      ["사업자명(이름)", "사업자번호(주민등록번호)", "연락처", "은행명", "계좌번호", "예금주", "청구방식"],
      ["테스트업체", "123-45-67890", "010-1234-5678", "국민은행", "1101234567", "대표", "세금계산서"],
    ];
    const { inputs, errors } = buildPayeeInputsFromRows(rows);
    expect(errors).toEqual([]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].bankName).toBe("국민은행");
  });
});
