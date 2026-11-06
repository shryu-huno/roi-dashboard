import { describe, it, expect } from "vitest";
import {
  performanceBatchSchema,
  expenseSchema,
  invoiceSchema,
  taskSchema,
  clientSchema,
  projectSchema,
  payeeUploadRowSchema,
  payeeUpdateSchema,
  payeeUpdatePmSchema,
  paymentRequestRowSchema,
  paymentRequestUploadRowSchema,
  paymentRequestUpdateSchema,
  paymentRequestUpdatePmSchema,
  paymentRequestBulkUpdateSchema,
  paymentRequestNoticeSchema,
  weeklySubmitSchema,
  bidSchema,
} from "@/lib/validation/schemas";

describe("performanceBatchSchema", () => {
  it("accepts a valid batch", () => {
    const r = performanceBatchSchema.safeParse({
      clientId: "c1", year: "2026", month: "3", rows: [{ taskId: "t1", count: "4" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rows[0].count).toBe(4);
  });
  it("rejects negative count", () => {
    const r = performanceBatchSchema.safeParse({
      clientId: "c1", year: 2026, month: 3, rows: [{ taskId: "t1", count: -1 }],
    });
    expect(r.success).toBe(false);
  });
  it("rejects month out of range", () => {
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2026, month: 13, rows: [] }).success).toBe(false);
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2026, month: 0, rows: [] }).success).toBe(false);
  });
  it("accepts a decimal count (부분 실적)", () => {
    const r = performanceBatchSchema.safeParse({ clientId: "c1", year: 2026, month: 3, rows: [{ taskId: "t1", count: 0.6 }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rows[0].count).toBe(0.6);
  });
});

describe("expenseSchema", () => {
  it("accepts a valid expense with memo", () => {
    const r = expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: 5000, memo: "회식" });
    expect(r.success).toBe(true);
  });
  it("rejects unknown category", () => {
    expect(expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "NOPE", amount: 1 }).success).toBe(false);
  });
  it("rejects negative amount", () => {
    expect(expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: -1 }).success).toBe(false);
  });
  it("strips thousands separators from amount", () => {
    const r = expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: "50,000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(50000);
  });
});

describe("invoiceSchema (계산서 단위 청구)", () => {
  it("accepts amount(VAT 포함)·발행일자·비고", () => {
    const r = invoiceSchema.safeParse({ clientId: "c1", amount: "1,100,000", issueDate: "2026-03-10", note: "3월분" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.amount).toBe(1100000); // 천단위 콤마 제거
      expect(r.data.issueDate).toBeInstanceOf(Date);
      expect(r.data.note).toBe("3월분");
    }
  });
  it("treats empty note as null", () => {
    const r = invoiceSchema.safeParse({ clientId: "c1", amount: "1000", issueDate: "2026-03-10", note: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.note).toBeNull();
  });
  it("rejects negative amount", () => {
    expect(invoiceSchema.safeParse({ clientId: "c1", amount: -5, issueDate: "2026-03-10" }).success).toBe(false);
  });
  it("rejects empty amount and empty client", () => {
    expect(invoiceSchema.safeParse({ clientId: "c1", amount: "", issueDate: "2026-03-10" }).success).toBe(false);
    expect(invoiceSchema.safeParse({ clientId: "", amount: 1000, issueDate: "2026-03-10" }).success).toBe(false);
  });
  it("rejects invalid issueDate", () => {
    expect(invoiceSchema.safeParse({ clientId: "c1", amount: 1000, issueDate: "" }).success).toBe(false);
  });
});

describe("taskSchema", () => {
  it("accepts a task with null contractCount (미입력)", () => {
    const r = taskSchema.safeParse({ clientId: "c1", projectId: "p1",name: "심리진단", unitPrice: 10000, contractCount: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contractCount).toBeNull();
  });
  it("accepts a contractCount", () => {
    const r = taskSchema.safeParse({ clientId: "c1", projectId: "p1",name: "심리진단", unitPrice: 10000, contractCount: "12" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contractCount).toBe(12);
  });
  it("strips thousands separators from unitPrice", () => {
    const r = taskSchema.safeParse({ clientId: "c1", projectId: "p1",name: "심리진단", unitPrice: "1,000,000", contractCount: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.unitPrice).toBe(1000000);
  });
  it("rejects empty name", () => {
    expect(taskSchema.safeParse({ clientId: "c1", projectId: "p1",name: "", unitPrice: 100 }).success).toBe(false);
  });
  it("rejects empty-string unitPrice", () => {
    expect(taskSchema.safeParse({ clientId: "c1", projectId: "p1",name: "x", unitPrice: "" }).success).toBe(false);
  });
  it("accepts a negative unitPrice (마이너스 조정/차감)", () => {
    const r = taskSchema.safeParse({ clientId: "c1", projectId: "p1",name: "심리진단", unitPrice: "-1,000,000", contractCount: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.unitPrice).toBe(-1000000);
  });
  it("accepts an explicit vatExempt and leaves it undefined when omitted", () => {
    const on = taskSchema.safeParse({ clientId: "c1", projectId: "p1", name: "면세", unitPrice: 10000, contractCount: "", vatExempt: true });
    expect(on.success).toBe(true);
    if (on.success) expect(on.data.vatExempt).toBe(true);
    const off = taskSchema.safeParse({ clientId: "c1", projectId: "p1", name: "과세", unitPrice: 10000, contractCount: "" });
    expect(off.success).toBe(true);
    if (off.success) expect(off.data.vatExempt).toBeUndefined();
  });
});

describe("expenseSchema – blank amount", () => {
  it("rejects empty-string amount", () => {
    expect(expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: "" }).success).toBe(false);
  });
});

describe("performanceBatchSchema – blank count & year bounds", () => {
  it("still accepts valid numeric-string count", () => {
    const r = performanceBatchSchema.safeParse({
      clientId: "c1", year: "2026", month: "3", rows: [{ taskId: "t1", count: "4" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rows[0].count).toBe(4);
  });
  it("rejects empty-string count in a row", () => {
    expect(performanceBatchSchema.safeParse({
      clientId: "c1", year: 2026, month: 3, rows: [{ taskId: "t1", count: "" }],
    }).success).toBe(false);
  });
  it("rejects year below range (1999)", () => {
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 1999, month: 3, rows: [] }).success).toBe(false);
  });
  it("rejects year above range (2101)", () => {
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2101, month: 3, rows: [] }).success).toBe(false);
  });
});

describe("clientSchema industry", () => {
  it("maps empty string industry to null", () => {
    const r = clientSchema.safeParse({ name: "A사", industry: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.industry).toBeNull();
  });
  it("keeps a provided industry", () => {
    const r = clientSchema.safeParse({ name: "A사", industry: "제조" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.industry).toBe("제조");
  });
});

describe("projectSchema", () => {
  it("parses cycles, pmIds, dates, and performanceContract", () => {
    const r = projectSchema.safeParse({
      clientId: "c1", name: "기본 프로젝트",
      contractStart: "2026-01-01", contractEnd: "2026-12-31",
      billingCycle: ["월", "분기"], reportCycle: "최종",
      performanceContract: "true", pmIds: ["u1", "u2"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.billingCycle).toEqual(["월", "분기"]);
      expect(r.data.reportCycle).toEqual(["최종"]);
      expect(r.data.performanceContract).toBe(true);
      expect(r.data.pmIds).toEqual(["u1", "u2"]);
    }
  });
  it("requires clientId and non-empty name", () => {
    expect(projectSchema.safeParse({ name: "P" }).success).toBe(false);
    expect(projectSchema.safeParse({ clientId: "c1", name: "" }).success).toBe(false);
  });
  it("defaults performanceContract to false and cycles to [] when absent", () => {
    const r = projectSchema.safeParse({ clientId: "c1", name: "P" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.performanceContract).toBe(false);
      expect(r.data.billingCycle).toEqual([]);
    }
  });
});

describe("payeeUploadRowSchema", () => {
  const valid = {
    bizName: "홍길동", bizNumber: "900101-1234567", phone: "010-1234-5678",
    bankName: "국민", accountNumber: "110-123-456789", accountHolder: "홍길동", taxType: "사업소득",
  };
  it("유효 행은 번호를 숫자만 남겨 통과", () => {
    const r = payeeUploadRowSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bizNumber).toBe("9001011234567");
  });
  it("번호 자릿수가 10/13이 아니면 실패", () => {
    expect(payeeUploadRowSchema.safeParse({ ...valid, bizNumber: "123" }).success).toBe(false);
  });
  it("알 수 없는 청구방식은 실패", () => {
    expect(payeeUploadRowSchema.safeParse({ ...valid, taxType: "카드" }).success).toBe(false);
  });
  it("필수 항목 누락은 실패", () => {
    expect(payeeUploadRowSchema.safeParse({ ...valid, accountHolder: "" }).success).toBe(false);
  });
});

describe("payeeUploadRowSchema 자릿수", () => {
  const base = { bizName: "이름", bizNumber: "1234567890", bankName: "국민", accountHolder: "대표", taxType: "세금계산서" as const };
  it("전화 8자리는 실패, 9자리는 통과", () => {
    expect(payeeUploadRowSchema.safeParse({ ...base, phone: "02-123-45", accountNumber: "1101234567" }).success).toBe(false);
    expect(payeeUploadRowSchema.safeParse({ ...base, phone: "021234567", accountNumber: "1101234567" }).success).toBe(true);
  });
  it("계좌 9자리는 실패, 10자리는 통과", () => {
    expect(payeeUploadRowSchema.safeParse({ ...base, phone: "01012345678", accountNumber: "123456789" }).success).toBe(false);
    expect(payeeUploadRowSchema.safeParse({ ...base, phone: "01012345678", accountNumber: "1234567890" }).success).toBe(true);
  });
});

describe("payeeUpdateSchema", () => {
  const valid = {
    bizName: "홍길동", bankName: "국민은행", accountNumber: "110-123-456789",
    accountHolder: "홍길동", taxType: "사업소득",
  };
  it("유효 입력은 통과", () => {
    expect(payeeUpdateSchema.safeParse(valid).success).toBe(true);
  });
  it("계좌번호 자릿수가 범위를 벗어나면 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, accountNumber: "123" }).success).toBe(false);
  });
  it("이름이 비어있으면 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, bizName: "" }).success).toBe(false);
  });
  it("은행명이 비어있으면 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, bankName: "" }).success).toBe(false);
  });
  it("알 수 없는 청구방식은 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, taxType: "카드" }).success).toBe(false);
  });
  it("이름이 공백만 있으면 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, bizName: "   " }).success).toBe(false);
  });
  it("예금주가 공백만 있으면 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, accountHolder: "   " }).success).toBe(false);
  });
});

describe("payeeUpdatePmSchema", () => {
  it("사업자명/청구방식만으로 통과", () => {
    expect(payeeUpdatePmSchema.safeParse({ bizName: "홍길동", taxType: "사업소득" }).success).toBe(true);
  });
  it("이름이 비어있으면 실패", () => {
    expect(payeeUpdatePmSchema.safeParse({ bizName: "", taxType: "사업소득" }).success).toBe(false);
  });
  it("알 수 없는 청구방식은 실패", () => {
    expect(payeeUpdatePmSchema.safeParse({ bizName: "홍길동", taxType: "카드" }).success).toBe(false);
  });
});

describe("paymentRequestRowSchema", () => {
  const valid = { entity: "HUNO", clientId: "c1", payeeId: "p1", unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" };

  it("유효한 값은 통과한다", () => {
    expect(paymentRequestRowSchema.safeParse(valid).success).toBe(true);
  });
  it("단가가 0이면 실패한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, unitPrice: 0 }).success).toBe(false);
  });
  it("횟수가 0이면 실패한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, count: 0 }).success).toBe(false);
  });
  it("교통비/재료비는 0이어도 통과한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, transportFee: 0, materialFee: 0 }).success).toBe(true);
  });
  it("알 수 없는 지급명의는 실패한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, entity: "HACKED" }).success).toBe(false);
  });
  it("고객사/사업자 id가 비어있으면 실패한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, clientId: "" }).success).toBe(false);
    expect(paymentRequestRowSchema.safeParse({ ...valid, payeeId: "" }).success).toBe(false);
  });
});

describe("paymentRequestUpdateSchema (정산담당자 인라인 수정)", () => {
  it("정상 입력을 통과시킨다", () => {
    const r = paymentRequestUpdateSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1", payDate: "2026-08-05", status: "COMPLETED",
    });
    expect(r.success).toBe(true);
  });
  it("빈 지급일은 null이 된다", () => {
    const r = paymentRequestUpdateSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1", payDate: "", status: "PREPARING",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payDate).toBeNull();
  });
  it("알 수 없는 entity/status는 거부한다", () => {
    expect(paymentRequestUpdateSchema.safeParse({ entity: "NOPE", clientId: "c1", payeeId: "p1", payDate: "", status: "PREPARING" }).success).toBe(false);
    expect(paymentRequestUpdateSchema.safeParse({ entity: "HUNO", clientId: "c1", payeeId: "p1", payDate: "", status: "NOPE" }).success).toBe(false);
  });
  it("clientId/payeeId가 비어있으면 거부한다", () => {
    expect(paymentRequestUpdateSchema.safeParse({ entity: "HUNO", clientId: "", payeeId: "p1", payDate: "", status: "PREPARING" }).success).toBe(false);
    expect(paymentRequestUpdateSchema.safeParse({ entity: "HUNO", clientId: "c1", payeeId: "", payDate: "", status: "PREPARING" }).success).toBe(false);
  });
  it("지급완료인데 지급일이 없으면 거부한다", () => {
    const r = paymentRequestUpdateSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1", payDate: "", status: "COMPLETED",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("지급완료 처리하려면 지급일을 입력해야 합니다.");
  });
  it("지급준비 상태면 지급일이 없어도 통과한다", () => {
    const r = paymentRequestUpdateSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1", payDate: "", status: "PREPARING",
    });
    expect(r.success).toBe(true);
  });
});

describe("paymentRequestUpdatePmSchema (PM 상세수정)", () => {
  it("정상 입력을 통과시킨다", () => {
    const r = paymentRequestUpdatePmSchema.safeParse({
      entity: "HUNO_INC", clientId: "c1", payeeId: "p1",
      unitPrice: "100000", transportFee: "0", materialFee: "0", count: "1", memo: "메모",
    });
    expect(r.success).toBe(true);
  });
  it("단가/횟수가 0이면 거부한다", () => {
    expect(paymentRequestUpdatePmSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1",
      unitPrice: "0", transportFee: "0", materialFee: "0", count: "1", memo: "",
    }).success).toBe(false);
    expect(paymentRequestUpdatePmSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1",
      unitPrice: "1", transportFee: "0", materialFee: "0", count: "0", memo: "",
    }).success).toBe(false);
  });
  it("교통비/재료비는 0을 허용한다", () => {
    const r = paymentRequestUpdatePmSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1",
      unitPrice: "1", transportFee: "0", materialFee: "0", count: "1", memo: "",
    });
    expect(r.success).toBe(true);
  });
});

describe("paymentRequestBulkUpdateSchema (일괄수정)", () => {
  it("정상 입력을 통과시킨다", () => {
    const r = paymentRequestBulkUpdateSchema.safeParse({ payDate: "2026-08-05", status: "COMPLETED" });
    expect(r.success).toBe(true);
  });
  it("빈 지급일은 null이 된다", () => {
    const r = paymentRequestBulkUpdateSchema.safeParse({ payDate: "", status: "PREPARING" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payDate).toBeNull();
  });
  it("지급완료인데 지급일이 없으면 거부한다", () => {
    const r = paymentRequestBulkUpdateSchema.safeParse({ payDate: "", status: "COMPLETED" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("지급완료 처리하려면 지급일을 입력해야 합니다.");
  });
  it("지급준비 상태면 지급일이 없어도 통과한다", () => {
    const r = paymentRequestBulkUpdateSchema.safeParse({ payDate: "", status: "PREPARING" });
    expect(r.success).toBe(true);
  });
});

describe("paymentRequestUploadRowSchema", () => {
  function row(overrides: Partial<{
    entity: string; clientName: string; bizName: string; accountNumber: string;
    bankName: string; accountHolder: string;
    unitPrice: string; transportFee: string; materialFee: string; count: string;
    taxType: string; memo: string;
  }> = {}) {
    return {
      entity: "휴노", clientName: "A사", bizName: "홍길동", accountNumber: "1101234567",
      bankName: "국민은행", accountHolder: "홍길동",
      unitPrice: "10000", transportFee: "0", materialFee: "0", count: "1",
      taxType: "세금계산서", memo: "",
      ...overrides,
    };
  }

  it("모든 필드가 채워지면 통과한다", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row()).success).toBe(true);
  });

  it("사업자명이 비어있으면 오류(매칭 성공 여부와 무관하게 항상 필수)", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ bizName: "" }));
    expect(result.success).toBe(false);
  });

  it("청구방식이 비어있어도 통과한다(매칭 성공 여부는 DB 조회 후에만 알 수 있음)", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ taxType: "" }));
    expect(result.success).toBe(true);
  });

  it("청구방식에 유효하지 않은 문자열을 넣으면 오류", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ taxType: "이상한값" }));
    expect(result.success).toBe(false);
  });

  it("은행명/예금주가 비어있어도 통과한다", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ bankName: "", accountHolder: "" }));
    expect(result.success).toBe(true);
  });

  it("계좌번호가 비어있으면 오류", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ accountNumber: "" }));
    expect(result.success).toBe(false);
  });

  it("계좌번호 형식이 9자리면 오류", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ accountNumber: "123456789" }));
    expect(result.success).toBe(false);
  });

  it("지급명의가 휴노/휴노INC가 아니면 오류", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row({ entity: "다른회사" })).success).toBe(false);
  });

  it("고객사명이 비어있으면 오류", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row({ clientName: "" })).success).toBe(false);
  });

  it("단가가 0이면 오류, 교통비/재료비는 0이어도 통과", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row({ unitPrice: "0" })).success).toBe(false);
    expect(paymentRequestUploadRowSchema.safeParse(row({ transportFee: "0", materialFee: "0" })).success).toBe(true);
  });

  it("횟수가 0이면 오류", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row({ count: "0" })).success).toBe(false);
  });

  it("교통비/재료비가 빈 문자열이면 0으로 처리된다", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ transportFee: "", materialFee: "" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transportFee).toBe(0);
      expect(result.data.materialFee).toBe(0);
    }
  });
});

describe("paymentRequestNoticeSchema", () => {
  it("일반 문자열을 그대로 허용한다", () => {
    const r = paymentRequestNoticeSchema.safeParse({ content: "정산 마감 안내드립니다." });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content).toBe("정산 마감 안내드립니다.");
  });

  it("앞뒤 공백은 trim한다", () => {
    const r = paymentRequestNoticeSchema.safeParse({ content: "  공지 내용  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content).toBe("공지 내용");
  });

  it("공백만 있으면 빈 문자열로 통과한다(공지 비우기)", () => {
    const r = paymentRequestNoticeSchema.safeParse({ content: "   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content).toBe("");
  });
});

describe("weeklySubmitSchema", () => {
  const base = {
    weekStart: "2026-11-01",
    entries: [{ clientId: "c1", thisWeek: "이번주", nextWeek: "다음주", note: "", noSpecial: false, version: null }],
    other: null,
  };

  it("정상 입력은 통과한다(기록이 없던 카드는 version null)", () => {
    expect(weeklySubmitSchema.safeParse(base).success).toBe(true);
  });

  it("기존 기록이 있던 카드는 version(1 이상 정수)을 받는다", () => {
    const ok = { ...base, entries: [{ ...base.entries[0], version: 3 }] };
    expect(weeklySubmitSchema.safeParse(ok).success).toBe(true);
    const bad = { ...base, entries: [{ ...base.entries[0], version: 0 }] };
    expect(weeklySubmitSchema.safeParse(bad).success).toBe(false);
  });

  it("주 키는 실제 존재하는 일요일 날짜여야 한다", () => {
    expect(weeklySubmitSchema.safeParse({ ...base, weekStart: "2026-11-02" }).success).toBe(false); // 월요일
    expect(weeklySubmitSchema.safeParse({ ...base, weekStart: "2026-02-30" }).success).toBe(false);
    expect(weeklySubmitSchema.safeParse({ ...base, weekStart: "" }).success).toBe(false);
  });

  it("같은 고객사 카드가 두 번 들어오면 거부한다", () => {
    const dup = { ...base, entries: [base.entries[0], { ...base.entries[0], thisWeek: "또" }] };
    expect(weeklySubmitSchema.safeParse(dup).success).toBe(false);
  });

  it("기타 업무: 정해진 구분만 허용하고 중복은 거부한다", () => {
    const other = { tags: ["TF", "내부 업무"], thisWeek: "회의", nextWeek: "", note: "" };
    expect(weeklySubmitSchema.safeParse({ ...base, other }).success).toBe(true);
    expect(weeklySubmitSchema.safeParse({ ...base, other: { ...other, tags: ["없는구분"] } }).success).toBe(false);
    expect(weeklySubmitSchema.safeParse({ ...base, other: { ...other, tags: ["TF", "TF"] } }).success).toBe(false);
  });
});

describe("bidSchema", () => {
  const ok = {
    orgName: "세움도시공사", title: "2027년 EAP 운영 용역", kind: "NEW", amount: "186,000,000",
    dueDate: "2026-11-12", announceDate: "2026-11-26", status: "PREPARING", note: "",
  };
  it("정상 입력은 통과하고 금액의 천단위 콤마를 처리한다", () => {
    const r = bidSchema.safeParse(ok);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(186_000_000);
  });
  it("발주처·사업명은 필수(공백만이면 거부)이고 앞뒤 공백은 지운다", () => {
    expect(bidSchema.safeParse({ ...ok, orgName: "   " }).success).toBe(false);
    expect(bidSchema.safeParse({ ...ok, title: "" }).success).toBe(false);
    const r = bidSchema.safeParse({ ...ok, orgName: "  세움  ", note: "  메모  " });
    expect(r.success && r.data.orgName).toBe("세움");
    expect(r.success && r.data.note).toBe("메모");
  });
  it("입찰 금액은 1원 이상의 정수", () => {
    expect(bidSchema.safeParse({ ...ok, amount: "0" }).success).toBe(false);
    expect(bidSchema.safeParse({ ...ok, amount: "" }).success).toBe(false);
    expect(bidSchema.safeParse({ ...ok, amount: "1.5" }).success).toBe(false);
    expect(bidSchema.safeParse({ ...ok, amount: -100 }).success).toBe(false);
  });
  it("제출 마감일은 실제 존재하는 날짜여야 한다", () => {
    expect(bidSchema.safeParse({ ...ok, dueDate: "" }).success).toBe(false);
    expect(bidSchema.safeParse({ ...ok, dueDate: "2026-02-30" }).success).toBe(false);
    expect(bidSchema.safeParse({ ...ok, dueDate: "2026/11/12" }).success).toBe(false);
  });
  it("결과 발표일이 비어 있으면 제출 마감일과 같게, 마감일보다 빠르면 거부", () => {
    const blank = bidSchema.safeParse({ ...ok, announceDate: "" });
    expect(blank.success && blank.data.announceDate).toBe("2026-11-12");
    expect(bidSchema.safeParse({ ...ok, announceDate: "2026-11-01" }).success).toBe(false);
    expect(bidSchema.safeParse({ ...ok, announceDate: "2026-11-12" }).success).toBe(true); // 같은 날은 허용
  });
  it("구분·상태는 정해진 값만", () => {
    expect(bidSchema.safeParse({ ...ok, kind: "OTHER" }).success).toBe(false);
    expect(bidSchema.safeParse({ ...ok, status: "준비중" }).success).toBe(false);
    for (const status of ["PREPARING", "REVIEWING", "WON", "LOST", "FAILED"]) expect(bidSchema.safeParse({ ...ok, status }).success).toBe(true);
  });
});
