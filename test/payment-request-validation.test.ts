import { describe, it, expect } from "vitest";
import {
  validateDraftRows, toPaymentRequestCreateInputs, type PaymentRequestDraftRow,
} from "@/lib/payment-request-validation";

function row(overrides: Partial<PaymentRequestDraftRow> = {}): PaymentRequestDraftRow {
  return {
    key: "r1", entity: "HUNO", clientId: "c1", payeeId: "p1",
    unitPrice: "10000", transportFee: "0", materialFee: "0", count: "1", memo: "",
    ...overrides,
  };
}

describe("validateDraftRows", () => {
  it("모든 필수값이 있으면 에러가 없다", () => {
    expect(validateDraftRows([row()]).size).toBe(0);
  });

  it("지급명의/고객사/사업자가 비어있으면 각각 에러를 낸다", () => {
    const errors = validateDraftRows([row({ entity: "", clientId: "", payeeId: null })]);
    expect(errors.get("r1")).toEqual(new Set(["entity", "clientId", "payeeId"]));
  });

  it("단가/횟수가 0 이하이면 에러를 낸다", () => {
    const errors = validateDraftRows([row({ unitPrice: "0", count: "0" })]);
    expect(errors.get("r1")).toEqual(new Set(["unitPrice", "count"]));
  });

  it("교통비/재료비는 0이어도 에러가 아니다", () => {
    expect(validateDraftRows([row({ transportFee: "0", materialFee: "0" })]).size).toBe(0);
  });

  it("여러 행 중 문제 있는 행만 에러 맵에 담는다", () => {
    const errors = validateDraftRows([row({ key: "ok" }), row({ key: "bad", clientId: "" })]);
    expect(errors.has("ok")).toBe(false);
    expect(errors.get("bad")).toEqual(new Set(["clientId"]));
  });
});

describe("toPaymentRequestCreateInputs", () => {
  it("문자열 필드를 숫자로 변환하고 필요한 필드만 남긴다", () => {
    const [input] = toPaymentRequestCreateInputs([
      row({ unitPrice: "50000", transportFee: "1000", materialFee: "2000", count: "3" }),
    ]);
    expect(input).toEqual({
      entity: "HUNO", clientId: "c1", payeeId: "p1",
      unitPrice: 50000, transportFee: 1000, materialFee: 2000, count: 3, memo: "",
    });
  });
});
