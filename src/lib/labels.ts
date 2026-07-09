import type { AppRole } from "@/lib/auth/rbac";

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
