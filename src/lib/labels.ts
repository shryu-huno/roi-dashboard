import type { AppRole } from "@/lib/auth/rbac";
import type { PayeeType, TaxType } from "@prisma/client";

export function roleLabel(role: AppRole | null | undefined): string {
  switch (role) {
    case "ADMIN": return "관리자";
    case "SETTLEMENT": return "정산담당자";
    case "PM": return "PM";
    default: return "미지정";
  }
}

export function statusLabel(status: "PENDING" | "ACTIVE" | "INACTIVE"): string {
  switch (status) {
    case "PENDING": return "승인대기";
    case "ACTIVE": return "활성";
    case "INACTIVE": return "비활성";
  }
}

export function expenseCategoryLabel(
  cat: "CORPORATE_CARD" | "PERSONAL_CARD" | "LABOR_COUNSELOR" | "LABOR_INSTRUCTOR" | "EDUCATION_PROGRAM" | "PROMOTION_OFFLINE" | "PROMOTION_EVENT" | "OPS_TRANSPORT" | "OPS_LODGING" | "OPS_FOOD" | "OPS_MEETING" | "TEST_MATERIAL" | "GENERAL_ETC",
): string {
  switch (cat) {
    case "CORPORATE_CARD": return "법인카드";
    case "PERSONAL_CARD": return "개인카드";
    case "LABOR_COUNSELOR": return "인건비(상담사)";
    case "LABOR_INSTRUCTOR": return "인건비(강사)";
    case "EDUCATION_PROGRAM": return "교육&프로그램 진행비";
    case "PROMOTION_OFFLINE": return "홍보비(오프라인)";
    case "PROMOTION_EVENT": return "홍보비(이벤트)";
    case "OPS_TRANSPORT": return "운영비(교통비)";
    case "OPS_LODGING": return "운영비(숙박비)";
    case "OPS_FOOD": return "운영비(식비)";
    case "OPS_MEETING": return "운영비(회의비)";
    case "TEST_MATERIAL": return "검사지 구매";
    case "GENERAL_ETC": return "일반관리(기타)";
  }
}

export const TAX_TYPE_LABELS = [
  "세금계산서", "면세계산서", "현금영수증", "수기계산서", "사업소득", "기타소득",
] as const;

export function taxTypeLabel(t: TaxType): string {
  switch (t) {
    case "TAX_INVOICE": return "세금계산서";
    case "TAX_FREE_INVOICE": return "면세계산서";
    case "CASH_RECEIPT": return "현금영수증";
    case "HANDWRITTEN_INVOICE": return "수기계산서";
    case "BUSINESS_INCOME": return "사업소득";
    case "OTHER_INCOME": return "기타소득";
  }
}

export const TAX_TYPE_BY_LABEL: Record<(typeof TAX_TYPE_LABELS)[number], TaxType> = {
  "세금계산서": "TAX_INVOICE",
  "면세계산서": "TAX_FREE_INVOICE",
  "현금영수증": "CASH_RECEIPT",
  "수기계산서": "HANDWRITTEN_INVOICE",
  "사업소득": "BUSINESS_INCOME",
  "기타소득": "OTHER_INCOME",
};

export function payeeTypeLabel(t: PayeeType): string {
  return t === "INSTRUCTOR" ? "강사" : "업체";
}

// 은행명 편집용 드롭다운 옵션.
export const BANKS = ["국민은행", "신한은행", "하나은행", "우리은행", "농협은행", "기업은행", "카카오뱅크", "토스뱅크"] as const;
