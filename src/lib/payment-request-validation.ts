// PM 지급요청 등록 화면(행 편집기)의 행별 필수값 검증 + 서버 액션 입력 변환. React에 의존하지
// 않는 순수 함수로 분리해 유닛 테스트한다. DraftRow(PaymentRequestRowsTable.tsx)는 여기 정의된
// PaymentRequestDraftRow보다 필드가 많지만(taxType/bizName 등) 구조적으로 호환되므로 그대로 넘길 수 있다.

export type PaymentRequestDraftRow = {
  key: string;
  entity: string;
  clientId: string;
  payeeId: string | null;
  unitPrice: string;
  transportFee: string;
  materialFee: string;
  count: string;
  memo: string;
};

export type PaymentRequestRowField = "entity" | "clientId" | "payeeId" | "unitPrice" | "count";

export type PaymentRequestCreateInput = {
  entity: "HUNO" | "HUNO_INC";
  clientId: string;
  payeeId: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  memo: string;
};

// 행별 필수값 검사. 교통비/재료비는 0을 허용하므로 검사 대상이 아니다. 한 행이라도 문제가
// 있으면 전체 저장을 막아야 하므로, 호출부는 이 Map이 비어있는지(size===0)로 저장 가능 여부를 판단한다.
export function validateDraftRows(rows: PaymentRequestDraftRow[]): Map<string, Set<PaymentRequestRowField>> {
  const errors = new Map<string, Set<PaymentRequestRowField>>();
  for (const row of rows) {
    const bad = new Set<PaymentRequestRowField>();
    if (!row.entity) bad.add("entity");
    if (!row.clientId) bad.add("clientId");
    if (!row.payeeId) bad.add("payeeId");
    if (Number(row.unitPrice) <= 0) bad.add("unitPrice");
    if (Number(row.count) <= 0) bad.add("count");
    if (bad.size > 0) errors.set(row.key, bad);
  }
  return errors;
}

// validateDraftRows가 빈 Map을 반환한 행만 이 함수로 넘겨야 한다 — entity/payeeId가 비어있지
// 않음을 전제로 캐스팅한다.
export function toPaymentRequestCreateInputs(rows: PaymentRequestDraftRow[]): PaymentRequestCreateInput[] {
  return rows.map((row) => ({
    entity: row.entity as "HUNO" | "HUNO_INC",
    clientId: row.clientId,
    payeeId: row.payeeId as string,
    unitPrice: Number(row.unitPrice) || 0,
    transportFee: Number(row.transportFee) || 0,
    materialFee: Number(row.materialFee) || 0,
    count: Number(row.count) || 0,
    memo: row.memo,
  }));
}
