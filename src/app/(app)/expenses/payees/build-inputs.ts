import { parseCsv } from "@/lib/csv";
import { payeeUploadRowSchema } from "@/lib/validation/schemas";
import { TAX_TYPE_BY_LABEL } from "@/lib/labels";
import {
  encrypt, blindIndex, digitsOnly, derivePayeeType, maskBizNumber, maskAccountNumber,
} from "@/lib/crypto/payee-secret";
import type { PayeeCreateInput } from "@/lib/data/payees";

// 필드 → 허용 헤더명(별칭). 기존 CSV 라벨과 신규 엑셀 서식 라벨을 모두 인식.
const HEADER_ALIASES: Record<string, string[]> = {
  이름: ["이름", "사업자명(이름)"],
  사업자번호: ["사업자번호", "사업자번호(주민등록번호)"],
  연락처: ["연락처"],
  은행: ["은행", "은행명"],
  계좌번호: ["계좌번호"],
  예금주: ["예금주"],
  청구방식: ["청구방식"],
};

export type BuildResult = {
  inputs: PayeeCreateInput[];
  errors: { row: number; message: string }[];
};

// CSV·엑셀 공통 코어: 첫 행을 헤더로 보고 별칭 매핑 후 행별 검증·암호화.
export function buildPayeeInputsFromRows(rows: string[][]): BuildResult {
  const inputs: PayeeCreateInput[] = [];
  const errors: BuildResult["errors"] = [];

  if (rows.length === 0) return { inputs, errors: [{ row: 0, message: "빈 파일입니다." }] };

  const header = rows[0].map((h) => h.trim());
  const colIndex: Record<string, number> = {};
  const missing: string[] = [];
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx === -1) missing.push(field);
    else colIndex[field] = idx;
  }
  if (missing.length > 0) {
    return { inputs, errors: [{ row: 0, message: `헤더 누락: ${missing.join(", ")}` }] };
  }
  const at = (cells: string[], field: string) => (cells[colIndex[field]] ?? "").trim();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => (c ?? "").trim() === "")) continue; // 빈 행 skip

    const parsed = payeeUploadRowSchema.safeParse({
      bizName: at(cells, "이름"),
      bizNumber: at(cells, "사업자번호"),
      phone: at(cells, "연락처"),
      bankName: at(cells, "은행"),
      accountNumber: at(cells, "계좌번호"),
      accountHolder: at(cells, "예금주"),
      taxType: at(cells, "청구방식"),
    });
    if (!parsed.success) {
      errors.push({ row: r + 1, message: parsed.error.issues[0]?.message ?? "형식 오류" });
      continue;
    }

    const d = parsed.data;
    const type = derivePayeeType(d.bizNumber)!; // 스키마가 10/13자리를 보장
    const acctDigits = digitsOnly(d.accountNumber);
    inputs.push({
      payeeType: type,
      bizName: d.bizName,
      bizNumberEnc: encrypt(d.bizNumber),
      bizNumberMasked: maskBizNumber(d.bizNumber, type),
      bizNumberBidx: blindIndex(d.bizNumber),
      phone: d.phone,
      phoneNormalized: digitsOnly(d.phone),
      bankName: d.bankName,
      accountNumberEnc: encrypt(acctDigits),
      accountNumberMasked: maskAccountNumber(acctDigits),
      accountHolder: d.accountHolder,
      taxType: TAX_TYPE_BY_LABEL[d.taxType],
    });
  }
  return { inputs, errors };
}

// CSV 진입점 — 파싱 후 공통 코어 재사용.
export function buildPayeeInputsFromCsv(csvText: string): BuildResult {
  return buildPayeeInputsFromRows(parseCsv(csvText));
}
