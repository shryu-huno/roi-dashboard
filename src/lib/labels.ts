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
  cat: "CORPORATE_CARD" | "PERSONAL_CARD" | "COUNSELING_FEE" | "INSTRUCTOR_FEE" | "PROMOTION" | "ETC",
): string {
  switch (cat) {
    case "CORPORATE_CARD": return "법인카드";
    case "PERSONAL_CARD": return "개인카드";
    case "COUNSELING_FEE": return "상담료";
    case "INSTRUCTOR_FEE": return "강사료";
    case "PROMOTION": return "홍보비용";
    case "ETC": return "기타";
  }
}
