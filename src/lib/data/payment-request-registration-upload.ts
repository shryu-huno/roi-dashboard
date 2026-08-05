import { paymentRequestUploadRowSchema } from "@/lib/validation/schemas";
import { PAYMENT_REQUEST_ENTITY_BY_LABEL } from "@/lib/labels";
import { digitsOnly } from "@/lib/crypto/payee-secret";
import type { PaymentRequestEntity } from "@prisma/client";

// 서식·업로드 공통 컬럼 순서. 정산담당자 다운로드 20컬럼에서 No/신청인/지급일/지급여부/
// 총지급액(자동·연동·서버계산 값)과 고유번호/연락처/사업자번호(매칭에 쓰이지 않음)를 제외한 12개.
export const REGISTRATION_TEMPLATE_HEADERS = [
  "지급명의", "고객사명", "사업자명(이름)", "은행명", "계좌번호", "예금주",
  "단가", "교통비", "재료비", "횟수", "청구방식", "상세내역",
] as const;

export type ParsedRegistrationRow = {
  entity: PaymentRequestEntity;
  clientName: string;
  // 사업자명+계좌번호가 지급 리스트와 모두 일치하면 매칭된 Payee 값으로 덮어써지고(무시),
  // 매칭 실패 시 예외 건(신규 등록)으로 이 값이 그대로 저장된다 — 매칭 여부와 무관하게 항상 필수.
  bizNameRaw: string;
  accountNumberDigits: string;
  taxTypeRaw: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  memo: string;
};

export type BuildRegistrationRowsResult = {
  rows: { row: number; data: ParsedRegistrationRow }[];
  errors: { row: number; message: string }[];
};

// 첫 행을 헤더로 보고 12개 컬럼을 이름으로 매핑한 뒤 행별로 검증한다. DB 접근 없음(순수 함수) —
// 고객사/사업자 매칭은 다음 단계(createPaymentRequestsFromUpload)의 책임이다.
export function buildPaymentRequestRegistrationRowsFromXlsx(rows: string[][]): BuildRegistrationRowsResult {
  const result: BuildRegistrationRowsResult = { rows: [], errors: [] };

  if (rows.length === 0) {
    result.errors.push({ row: 0, message: "빈 파일입니다." });
    return result;
  }

  const header = rows[0].map((h) => h.trim());
  const colIndex: Record<string, number> = {};
  const missing: string[] = [];
  for (const field of REGISTRATION_TEMPLATE_HEADERS) {
    const idx = header.indexOf(field);
    if (idx === -1) missing.push(field);
    else colIndex[field] = idx;
  }
  if (missing.length > 0) {
    result.errors.push({ row: 0, message: `헤더 누락: ${missing.join(", ")}` });
    return result;
  }
  const at = (cells: string[], field: (typeof REGISTRATION_TEMPLATE_HEADERS)[number]) =>
    (cells[colIndex[field]] ?? "").trim();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => (c ?? "").trim() === "")) continue;

    const parsed = paymentRequestUploadRowSchema.safeParse({
      entity: at(cells, "지급명의"),
      clientName: at(cells, "고객사명"),
      bizName: at(cells, "사업자명(이름)"),
      accountNumber: at(cells, "계좌번호"),
      unitPrice: at(cells, "단가"),
      transportFee: at(cells, "교통비"),
      materialFee: at(cells, "재료비"),
      count: at(cells, "횟수"),
      taxType: at(cells, "청구방식"),
      memo: at(cells, "상세내역"),
    });
    if (!parsed.success) {
      result.errors.push({ row: r + 1, message: parsed.error.issues[0]?.message ?? "형식 오류" });
      continue;
    }

    const d = parsed.data;
    result.rows.push({
      row: r + 1,
      data: {
        entity: PAYMENT_REQUEST_ENTITY_BY_LABEL[d.entity],
        clientName: d.clientName,
        bizNameRaw: d.bizName,
        accountNumberDigits: digitsOnly(d.accountNumber),
        taxTypeRaw: d.taxType,
        unitPrice: d.unitPrice,
        transportFee: d.transportFee,
        materialFee: d.materialFee,
        count: d.count,
        memo: d.memo,
      },
    });
  }
  return result;
}
