import { z } from "zod";
import { CYCLE_VALUES } from "@/lib/clients/summary-view";

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

// 부호 있는 정수 금액. 단가는 음수(마이너스 조정/차감)도 허용한다. 빈 문자열은 거부(NaN).
const signedInt = z.preprocess(
  (v) => {
    const s = stripCommas(v);
    return typeof s === "string" && s.trim() === "" ? NaN : s;
  },
  z.coerce.number().int(),
);

// 빈 문자열/undefined → null, 그 외엔 정수(≥0). "없음(null) vs 0" 구분용.
const nullableAmount = z.preprocess(
  (v) => {
    const s = stripCommas(v);
    return s === "" || s === undefined || s === null ? null : s;
  },
  z.coerce.number().int().min(0).nullable(),
);

// 빈 문자열/undefined → null, 그 외엔 부호 있는 정수. 계약금 수동 입력용(음수 조정 허용).
const nullableSignedAmount = z.preprocess(
  (v) => {
    const s = stripCommas(v);
    return s === "" || s === undefined || s === null ? null : s;
  },
  z.coerce.number().int().nullable(),
);

// 체크박스 그룹(복수). 배열이 아니면 단일값을 배열로 감싸고, 빈 값은 걸러낸 뒤 주기 enum으로 검증.
const cycleArray = z.preprocess(
  (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).filter((x) => x !== "" && x != null),
  z.array(z.enum(CYCLE_VALUES)),
);

export const clientSchema = z.object({
  name: z.string().min(1),
  status: z.string().optional(),
  businessType: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
  industry: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
  // 담당자 연락처(선택). 빈칸→null(클리어), 미포함→undefined(스킵). industry와 동일 규칙.
  contactName: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
  contactEmail: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
  contactPhone: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
  contractStart: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
  contractEnd: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
  // 담당 PM 여러 명. 빈 값은 걸러내고, 미포함이면 undefined(배정 유지).
  pmIds: z.preprocess(
    (v) => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]).filter((x) => x !== "" && x != null)),
    z.array(z.string()).optional(),
  ),
  // 청구·보고 주기(복수 선택). 체크박스는 항상 폼에 있으므로 미선택이면 [](클리어).
  billingCycle: cycleArray,
  reportCycle: cycleArray,
});

export const taskSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  unitPrice: signedInt,
  // 계약 횟수(빈칸=미입력=null).
  contractCount: nullableAmount,
  // 계약금은 단가×횟수로 자동 계산되지만 사용자가 직접 수정할 수 있다.
  // 빈칸이면 서버가 단가×횟수로 파생한다.
  contractAmount: nullableSignedAmount,
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
