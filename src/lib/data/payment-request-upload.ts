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

const FULL_DATE = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/;
const MONTH_DAY = /^(\d{1,2})[-./](\d{1,2})$/;

// 파싱 시점의 KST 기준 올해 — 연도가 생략된 지급일("8/15" 등)을 보완할 때 사용.
function currentKstYear(): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// 구분자(-, ., /)와 앞자리 0 생략을 허용하고, 연도가 생략되면 올해로 채워 "YYYY-MM-DD"로 정규화한다.
// 일-월 순서(DD/MM), 2자리 연도, 한글 혼합 표기는 의도적으로 지원하지 않는다(모호성 위험).
function normalizeDateCell(value: string): string | undefined {
  const full = FULL_DATE.exec(value);
  if (full) {
    const [, y, m, d] = full;
    return `${y}-${pad2(Number(m))}-${pad2(Number(d))}`;
  }
  const monthDay = MONTH_DAY.exec(value);
  if (monthDay) {
    const [, m, d] = monthDay;
    return `${currentKstYear()}-${pad2(Number(m))}-${pad2(Number(d))}`;
  }
  return undefined;
}

// <input type="date">와 동일하게 "YYYY-MM-DD"(및 위 정규화로 흡수되는 변형)만 허용.
// 달력 유효성 검증: 예를 들어 "2026-02-30"은 2월 30일이 존재하지 않으므로 거부.
// 지급일은 KST 달력일 기준으로 표시/파싱한다 — DB에는 그 날짜의 UTC 자정(00:00:00Z)으로
// 저장된다. 다른 곳에서 payDate를 쓸 때도 이 규약을 맞춰야 재업로드 시 날짜가 밀리지 않는다.
function parseDateCell(value: string): Date | undefined {
  const normalized = normalizeDateCell(value);
  if (!normalized) return undefined;
  const d = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;

  // Date 생성자는 범위를 벗어난 날짜를 자동으로 정규화한다.
  // 예: new Date("2026-02-30T...") → 2026-03-02
  // 따라서 입력 컴포넌트와 파싱된 Date의 UTC 컴포넌트가 일치하는지 확인해야 한다.
  const [inputYear, inputMonth, inputDay] = normalized.split("-").map(Number);
  if (
    d.getUTCFullYear() !== inputYear ||
    d.getUTCMonth() + 1 !== inputMonth ||
    d.getUTCDate() !== inputDay
  ) {
    return undefined;
  }
  return d;
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
    if (!/^\d+$/.test(noCell) || Number(noCell) <= 0) {
      errors.push({ row: rowNum, message: "No 값이 올바르지 않습니다." });
      continue;
    }
    const seqNo = Number(noCell);

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
