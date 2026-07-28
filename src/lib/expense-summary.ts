// 전체 내역 요약표 전용 분류 정의. 기존 13개 EXPENSE_CATEGORIES(validation/schemas.ts)와 별개다.
// key는 상세 페이지(/expenses/detail)의 category 쿼리 파라미터로 쓰인다.
export const EXPENSE_SUMMARY_CATEGORIES = [
  { key: "payment", label: "지급 내역" },
  { key: "consulting", label: "상담비" },
  { key: "corporate-card", label: "법인카드" },
  { key: "personal-card", label: "개인카드" },
  { key: "promotion", label: "홍보비" },
  { key: "hipass", label: "하이패스" },
] as const;

export type ExpenseSummaryKey = (typeof EXPENSE_SUMMARY_CATEGORIES)[number]["key"];

// 알 수 없는 category 값(URL 조작 등)은 undefined 반환 — 호출부가 리다이렉트하도록.
export function parseExpenseSummaryKey(value: string | undefined): ExpenseSummaryKey | undefined {
  return EXPENSE_SUMMARY_CATEGORIES.find((c) => c.key === value)?.key;
}

export function expenseSummaryLabel(key: ExpenseSummaryKey): string {
  return EXPENSE_SUMMARY_CATEGORIES.find((c) => c.key === key)!.label;
}
