import { z } from "zod";
import { CYCLE_VALUES } from "@/lib/clients/summary-view";
import { PAYMENT_REQUEST_ENTITY_LABELS, TAX_TYPE_LABELS } from "@/lib/labels";

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

// 엑셀/CSV 한 행(문자열)을 검증. 번호는 숫자만 남겨 10/13자리인지 확인(업체/강사 판별 근거).
const bizNumberDigits = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/\D/g, "") : v),
  z.string().refine((s) => s.length === 10 || s.length === 13,
    "사업자번호(10자리) 또는 주민등록번호(13자리)여야 합니다."),
);

// 숫자만 남긴 길이로 자릿수 검증(하이픈·공백 허용).
const phoneField = z.string().refine(
  (s) => { const d = s.replace(/\D/g, ""); return d.length >= 9 && d.length <= 11; },
  "연락처는 숫자 9~11자리여야 합니다.",
);
const accountField = z.string().refine(
  (s) => { const d = s.replace(/\D/g, ""); return d.length >= 10 && d.length <= 16; },
  "계좌번호는 숫자 10~16자리여야 합니다.",
);

export const payeeUploadRowSchema = z.object({
  bizName: z.string().min(1, "이름은 필수입니다."),
  bizNumber: bizNumberDigits,
  phone: phoneField,
  bankName: z.string().min(1, "은행명은 필수입니다."),
  accountNumber: accountField,
  accountHolder: z.string().min(1, "예금주는 필수입니다."),
  taxType: z.enum(TAX_TYPE_LABELS),
});

// 지급 리스트 인라인 수정용 — 업로드와 달리 사업자번호/연락처는 다루지 않는다.
export const payeeUpdateSchema = z.object({
  bizName: z.string().trim().min(1, "이름은 필수입니다."),
  bankName: z.string().min(1, "은행명은 필수입니다."),
  accountNumber: accountField,
  accountHolder: z.string().trim().min(1, "예금주는 필수입니다."),
  taxType: z.enum(TAX_TYPE_LABELS),
});

// PM 인라인 수정용 — 사업자명/청구방식만 다룬다.
export const payeeUpdatePmSchema = z.object({
  bizName: z.string().trim().min(1, "이름은 필수입니다."),
  taxType: z.enum(TAX_TYPE_LABELS),
});

// PM 등록 화면 행 하나. 단가/횟수는 0보다 커야 하고(0이면 무의미), 교통비/재료비는 0을 허용한다.
// entity/payeeId/clientId는 화면에서 자동완성/드롭다운으로만 채워지므로 빈 문자열이면 거부한다.
export const paymentRequestRowSchema = z.object({
  entity: z.enum(["HUNO", "HUNO_INC"]),
  clientId: z.string().min(1),
  payeeId: z.string().min(1),
  unitPrice: z.coerce.number().int().min(1),
  transportFee: z.coerce.number().int().min(0),
  materialFee: z.coerce.number().int().min(0),
  count: z.coerce.number().int().min(1),
  memo: z.string(),
});

// 사업자번호(선택) — 값이 있으면 10/13자리(하이픈 허용), 없으면(빈 문자열) 통과.
// 필수 버전(bizNumberDigits, 107~112행)과 자릿수 검증 로직은 같고 "0자리 허용"만 다르다.
const optionalBizNumberDigits = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/\D/g, "") : v),
  z.string().refine((s) => s.length === 0 || s.length === 10 || s.length === 13,
    "사업자번호는 10자리(사업자) 또는 13자리(주민등록번호)여야 합니다."),
);

// PM 엑셀 대량 등록 한 행. 고유번호/사업자번호 중 하나라도 있으면 지급 리스트와 연동되는
// "연동 행"으로 보고 사업자명/청구방식을 검사하지 않는다(매칭된 Payee 값으로 서버가 덮어씀).
// 둘 다 없으면 "예외 행"으로 보고 사업자명/청구방식이 직접 저장되므로 필수로 검사한다.
export const paymentRequestUploadRowSchema = z.object({
  entity: z.enum(PAYMENT_REQUEST_ENTITY_LABELS),
  clientName: z.string().trim().min(1, "고객사명을 입력하세요."),
  bizNameRaw: z.string().trim(),
  keyId: z.string().trim(),
  bizNumberDigits: optionalBizNumberDigits,
  unitPrice: z.coerce.number().int().min(1),
  transportFee: z.coerce.number().int().min(0),
  materialFee: z.coerce.number().int().min(0),
  count: z.coerce.number().int().min(1),
  taxTypeRaw: z.string().trim(),
  memo: z.string(),
}).superRefine((v, ctx) => {
  const hasMatchKey = v.keyId.length > 0 || v.bizNumberDigits.length > 0;
  if (hasMatchKey) return;
  if (v.bizNameRaw.length === 0) {
    ctx.addIssue({ code: "custom", path: ["bizNameRaw"], message: "사업자명을 입력하세요(지급 리스트에 없는 경우 필수)." });
  }
  if (!(TAX_TYPE_LABELS as readonly string[]).includes(v.taxTypeRaw)) {
    ctx.addIssue({ code: "custom", path: ["taxTypeRaw"], message: "청구방식을 선택하세요(지급 리스트에 없는 경우 필수)." });
  }
});

// 지급요청 인라인 수정(정산담당자) — 지급명의/고객사/사업자명/지급일/지급여부.
// 지급완료인데 지급일이 없는 조합은 엑셀 재업로드 경로(payment-request-upload.ts)와
// 동일하게 거부한다 — payDate를 조용히 null로 저장하지 않는다.
export const paymentRequestUpdateSchema = z.object({
  entity: z.enum(["HUNO", "HUNO_INC"]),
  clientId: z.string().min(1),
  payeeId: z.string().min(1),
  payDate: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable()),
  status: z.enum(["PREPARING", "COMPLETED"]),
}).refine((v) => !(v.status === "COMPLETED" && v.payDate === null), {
  message: "지급완료 처리하려면 지급일을 입력해야 합니다.",
});

// 지급요청 상세수정(PM) — 등록 시 작성한 항목 전체(지급일/지급여부 제외, 정산담당자 전담).
export const paymentRequestUpdatePmSchema = z.object({
  entity: z.enum(["HUNO", "HUNO_INC"]),
  clientId: z.string().min(1),
  payeeId: z.string().min(1),
  unitPrice: z.coerce.number().int().min(1),
  transportFee: z.coerce.number().int().min(0),
  materialFee: z.coerce.number().int().min(0),
  count: z.coerce.number().int().min(1),
  memo: z.string(),
});

// 지급요청 일괄수정 — 선택된 건들에 동일하게 적용할 지급일/지급여부.
// 지급완료인데 지급일이 없는 조합은 엑셀 재업로드 경로와 동일하게 거부한다.
export const paymentRequestBulkUpdateSchema = z.object({
  payDate: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable()),
  status: z.enum(["PREPARING", "COMPLETED"]),
}).refine((v) => !(v.status === "COMPLETED" && v.payDate === null), {
  message: "지급완료 처리하려면 지급일을 입력해야 합니다.",
});

// 지급요청 공지 배너 — 항상 최대 1개, trim 후 빈 문자열이면 공지 없음 상태로 저장된다.
export const paymentRequestNoticeSchema = z.object({
  content: z.string().trim(),
});
