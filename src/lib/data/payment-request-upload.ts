import type { PaymentRequestStatus } from "@prisma/client";

export type PaymentRequestUpdateInput = {
  row: number;
  seqNo: number;
  payDate: Date | null;
  status: PaymentRequestStatus;
};

export type PaymentRequestUpdateBuildResult = {
  updates: PaymentRequestUpdateInput[];
  errors: { row: number; message: string }[];
};

const HEADERS = ["No", "지급일", "지급여부"] as const;

const STATUS_BY_LABEL: Record<string, PaymentRequestStatus> = {
  "지급준비": "PREPARING",
  "지급완료": "COMPLETED",
};

// <input type="date">와 동일하게 "YYYY-MM-DD"만 허용.
function parseDateCell(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// 엑셀 재업로드 파싱 — 헤더에서 "No"/"지급일"/"지급여부" 3개만 이름으로 찾아 읽는다(나머지 컬럼은
// 반영 대상이 아니므로 무시). No로 매칭될 대상 존재 여부는 여기서 확인하지 않는다(DB 조회가
// 필요해 데이터 계층의 몫 — updatePaymentRequestsBulk가 담당).
export function buildPaymentRequestUpdatesFromRows(rows: string[][]): PaymentRequestUpdateBuildResult {
  const updates: PaymentRequestUpdateInput[] = [];
  const errors: PaymentRequestUpdateBuildResult["errors"] = [];

  if (rows.length === 0) return { updates, errors: [{ row: 0, message: "빈 파일입니다." }] };

  const header = rows[0].map((h) => h.trim());
  const colIndex: Record<string, number> = {};
  const missing: string[] = [];
  for (const field of HEADERS) {
    const idx = header.indexOf(field);
    if (idx === -1) missing.push(field);
    else colIndex[field] = idx;
  }
  if (missing.length > 0) {
    return { updates, errors: [{ row: 0, message: `헤더 누락: ${missing.join(", ")}` }] };
  }
  const at = (cells: string[], field: string) => (cells[colIndex[field]] ?? "").trim();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => (c ?? "").trim() === "")) continue; // 빈 행 skip
    const rowNum = r + 1;

    const noCell = at(cells, "No");
    const seqNo = Number(noCell);
    if (!noCell || !Number.isInteger(seqNo) || seqNo <= 0) {
      errors.push({ row: rowNum, message: "No 값이 올바르지 않습니다." });
      continue;
    }

    const statusLabel = at(cells, "지급여부");
    const status = STATUS_BY_LABEL[statusLabel];
    if (!status) {
      errors.push({ row: rowNum, message: "지급여부 값이 올바르지 않습니다(지급준비/지급완료 중 하나여야 함)." });
      continue;
    }

    const payDateCell = at(cells, "지급일");
    let payDate: Date | null = null;
    if (payDateCell) {
      const parsed = parseDateCell(payDateCell);
      if (!parsed) {
        errors.push({ row: rowNum, message: "지급일 형식이 올바르지 않습니다(YYYY-MM-DD)." });
        continue;
      }
      payDate = parsed;
    } else if (status === "COMPLETED") {
      errors.push({ row: rowNum, message: "지급완료 처리하려면 지급일을 입력해야 합니다." });
      continue;
    }

    updates.push({ row: rowNum, seqNo, payDate, status });
  }

  return { updates, errors };
}
