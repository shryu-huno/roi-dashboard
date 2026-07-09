import { z } from "zod";

export const EXPENSE_CATEGORIES = [
  "CORPORATE_CARD", "PERSONAL_CARD", "LABOR_COUNSELOR", "LABOR_INSTRUCTOR",
  "EDUCATION_PROGRAM", "PROMOTION_OFFLINE", "PROMOTION_EVENT", "OPS_TRANSPORT",
  "OPS_LODGING", "OPS_FOOD", "OPS_MEETING", "TEST_MATERIAL", "GENERAL_ETC",
] as const;

const year = z.coerce.number().int().min(2000).max(2100);
const month = z.coerce.number().int().min(1).max(12);

// 화면 입력폼은 천단위 콤마("1,000,000")를 보낼 수 있으므로 숫자 강제 전에 콤마를 제거한다.
const stripCommas = (v: unknown) => (typeof v === "string" ? v.replace(/,/g, "") : v);

// 비-nullable 정수 금액(≥0). 빈 문자열은 0으로 조용히 강제되지 않고 거부된다
// (수익 대시보드에서 단가 빈칸이 0으로 저장되는 사고 방지).
const nonNegInt = z.preprocess(
  (v) => {
    const s = stripCommas(v);
    return typeof s === "string" && s.trim() === "" ? NaN : s;
  },
  z.coerce.number().int().min(0),
);

// 빈 문자열/undefined → null, 그 외엔 정수(≥0). "없음(null) vs 0" 구분용.
const nullableAmount = z.preprocess(
  (v) => {
    const s = stripCommas(v);
    return s === "" || s === undefined || s === null ? null : s;
  },
  z.coerce.number().int().min(0).nullable(),
);

export const clientSchema = z.object({
  name: z.string().min(1),
  status: z.string().optional(),
  contractStart: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
  contractEnd: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
  pmId: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
});

export const taskSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  unitPrice: nonNegInt,
  // 계약금은 저장 시 단가×횟수로 파생한다. 폼은 계약 횟수만 입력한다(빈칸=미입력=null).
  contractCount: nullableAmount,
});

export const performanceBatchSchema = z.object({
  clientId: z.string().min(1),
  year,
  month,
  rows: z.array(z.object({ taskId: z.string().min(1), count: nonNegInt })),
});

export const expenseSchema = z.object({
  clientId: z.string().min(1),
  year,
  month,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: nonNegInt,
  memo: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
});

export const billingSchema = z.object({ clientId: z.string().min(1), year, month, amount: nullableAmount });
export const depositSchema = billingSchema;
