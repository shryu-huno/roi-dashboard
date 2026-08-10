import ExcelJS from "exceljs";
import { paymentRequestEntityLabel, taxTypeLabel, paymentRequestStatusLabel, PAYMENT_REQUEST_STATUS_LABELS, PAYMENT_REQUEST_ENTITY_LABELS, TAX_TYPE_LABELS } from "@/lib/labels";
import type { PaymentRequestExportRow } from "@/lib/data/payment-requests";
import { REGISTRATION_TEMPLATE_HEADERS } from "@/lib/data/payment-request-registration-upload";

// 열 너비 계산용 — 한글(전각) 1자를 폭 2로, 그 외 1자를 폭 1로 취급.
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    width += code >= 0xac00 && code <= 0xd7a3 ? 2 : 1;
  }
  return width;
}

// 1-based 컬럼 번호 → 엑셀 열 문자(A, B, C, ...). 컬럼이 20개뿐이라 A~Z 범위로 충분.
function colLetter(colNumber: number): string {
  return String.fromCharCode("A".charCodeAt(0) + colNumber - 1);
}

// 화면 목록의 컬럼 + 지급 리스트 연동 컬럼 + 재업로드용 지급일/지급여부를 합친 컬럼 순서.
// "No"/"지급일"/"지급여부"는 재업로드 시 이 이름 그대로 헤더에서 찾아 읽으므로 문자열을 바꾸면 안 된다.
export const EXPORT_HEADERS = [
  "No", "신청인", "지급명의", "고객사명", "사업자명(이름)", "고유번호", "연락처",
  "사업자번호(주민등록번호)", "은행명", "계좌번호", "예금주", "단가", "교통비",
  "재료비", "횟수", "총지급액", "청구방식", "상세내역", "지급일", "지급여부",
] as const;

const TEXT_COLUMNS = ["사업자번호(주민등록번호)", "계좌번호", "지급일"] as const;
const NUMBER_COLUMNS = ["단가", "교통비", "재료비", "횟수", "총지급액"] as const;

// 지급일은 KST 달력일 기준으로 표시/파싱한다 — DB에는 그 날짜의 UTC 자정(00:00:00Z)으로
// 저장된다. 다른 곳에서 payDate를 쓸 때도 이 규약을 맞춰야 재업로드 시 날짜가 밀리지 않는다.
function formatPayDate(d: Date | null): string {
  return d ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : "";
}

// 검색 결과를 그대로 내려받는 다운로드용 워크북. 대부분 읽기 전용 스타일이지만, 지급일/지급여부는
// 재업로드용 편집 대상이라 지급여부에는 드롭다운 유효성 검사를 건다.
export async function buildPaymentRequestExportXlsxBuffer(rows: PaymentRequestExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("지급요청리스트");

  const dataRows = rows.map((r) => [
    r.seqNo,
    r.requesterName,
    paymentRequestEntityLabel(r.entity),
    r.clientName,
    r.bizName,
    r.payeeKeyId,
    r.phone,
    r.bizNumber,
    r.bankName,
    r.accountNumber,
    r.accountHolder,
    r.unitPrice,
    r.transportFee,
    r.materialFee,
    r.count,
    r.amount,
    taxTypeLabel(r.taxType),
    r.memo,
    formatPayDate(r.payDate),
    paymentRequestStatusLabel(r.status),
  ]);
  ws.addRow([...EXPORT_HEADERS]);
  dataRows.forEach((row) => ws.addRow(row));

  // 사업자번호·계좌번호·지급일은 텍스트 서식으로 — 선행 0/자릿수 손실 및 날짜 자동변환 방지.
  TEXT_COLUMNS.forEach((header) => {
    ws.getColumn(EXPORT_HEADERS.indexOf(header) + 1).numFmt = "@";
  });
  // 금액 컬럼은 천단위 콤마 서식.
  NUMBER_COLUMNS.forEach((header) => {
    ws.getColumn(EXPORT_HEADERS.indexOf(header) + 1).numFmt = "#,##0";
  });

  // 열 너비 — 헤더와 실제 데이터 중 가장 넓은 값 기준.
  const COLUMN_WIDTH_PADDING = 4;
  const MAX_COLUMN_WIDTH = 60;
  EXPORT_HEADERS.forEach((header, i) => {
    const candidates = [header, ...dataRows.map((row) => String(row[i]))];
    ws.getColumn(i + 1).width = Math.min(Math.max(...candidates.map(displayWidth)) + COLUMN_WIDTH_PADDING, MAX_COLUMN_WIDTH);
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
  };
  for (let r = 1; r <= dataRows.length + 1; r++) {
    const isHeader = r === 1;
    for (let c = 1; c <= EXPORT_HEADERS.length; c++) {
      const cell = ws.getCell(r, c);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder;
      if (isHeader) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
      }
    }
  }

  // 지급여부 컬럼에 드롭다운(목록 유효성 검사) 적용 — 재업로드 시 오타로 잘못된 값이 들어가는 걸 막는다.
  if (dataRows.length > 0) {
    // exceljs 타입 정의에 Worksheet.dataValidations가 누락돼 있어 unknown 경유로 우회.
    const dataValidations = (ws as unknown as {
      dataValidations: { add: (address: string, dv: ExcelJS.DataValidation) => void };
    }).dataValidations;
    const statusCol = colLetter(EXPORT_HEADERS.indexOf("지급여부") + 1);
    dataValidations.add(`${statusCol}2:${statusCol}${dataRows.length + 1}`, {
      type: "list",
      allowBlank: false,
      formulae: [`"${PAYMENT_REQUEST_STATUS_LABELS.join(",")}"`],
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: "값 오류",
      error: `${PAYMENT_REQUEST_STATUS_LABELS.join("/")} 중 하나만 선택하세요.`,
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

const REGISTRATION_TEMPLATE_DATA_ROWS = 1000;

const REGISTRATION_HEADER_NOTES: Partial<Record<(typeof REGISTRATION_TEMPLATE_HEADERS)[number], string>> = {
  "지급명의": "필수",
  "고객사명": "필수",
  "사업자명(이름)": "필수 — 계좌번호와 함께 지급 리스트와 일치하면 자동 연동됩니다.",
  "은행명": "선택 — 지급 리스트와 자동 연동되면 생략 가능(단, 값을 입력했는데 지급 리스트와 다르면 오류). 지급 리스트에 없으면 필수.",
  "계좌번호": "필수 — 사업자명과 함께 지급 리스트와 일치하면 자동 연동됩니다.",
  "예금주": "선택 — 지급 리스트와 자동 연동되면 생략 가능(단, 값을 입력했는데 지급 리스트와 다르면 오류). 지급 리스트에 없으면 필수.",
  "단가": "필수",
  "횟수": "필수",
  "청구방식": "선택 — 지급 리스트와 자동 연동되면 생략 가능(단, 값을 입력했는데 지급 리스트와 다르면 오류). 지급 리스트에 없으면 필수.",
};

// PM 엑셀 대량 등록용 빈 서식. payees/xlsx.ts의 buildTemplateXlsxBuffer와 같은 패턴
// (헤더 고정 + 드롭다운 + 시트 보호)을 이 파일 전용 컬럼(12개)으로 적용한다.
export async function buildPaymentRequestRegistrationTemplateXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("지급요청등록");
  ws.addRow([...REGISTRATION_TEMPLATE_HEADERS]);

  const TEXT_COLUMNS = ["계좌번호"] as const;
  TEXT_COLUMNS.forEach((h) => { ws.getColumn(REGISTRATION_TEMPLATE_HEADERS.indexOf(h) + 1).numFmt = "@"; });

  const COLUMN_WIDTH_PADDING = 4;
  REGISTRATION_TEMPLATE_HEADERS.forEach((header, i) => {
    const candidates = header === "청구방식" ? [header, ...TAX_TYPE_LABELS]
      : header === "지급명의" ? [header, ...PAYMENT_REQUEST_ENTITY_LABELS]
      : [header];
    ws.getColumn(i + 1).width = Math.max(...candidates.map(displayWidth)) + COLUMN_WIDTH_PADDING;
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
  };
  for (let r = 1; r <= REGISTRATION_TEMPLATE_DATA_ROWS + 1; r++) {
    const isHeader = r === 1;
    for (let c = 1; c <= REGISTRATION_TEMPLATE_HEADERS.length; c++) {
      const cell = ws.getCell(r, c);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder;
      cell.protection = { locked: isHeader };
      if (isHeader) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
        const note = REGISTRATION_HEADER_NOTES[REGISTRATION_TEMPLATE_HEADERS[c - 1]];
        if (note) cell.note = note;
      }
    }
  }

  // exceljs 타입 정의에 Worksheet.dataValidations가 누락돼 있어 unknown 경유로 우회.
  const dataValidations = (ws as unknown as {
    dataValidations: { add: (address: string, dv: ExcelJS.DataValidation) => void };
  }).dataValidations;
  const entityCol = colLetter(REGISTRATION_TEMPLATE_HEADERS.indexOf("지급명의") + 1);
  dataValidations.add(`${entityCol}2:${entityCol}${REGISTRATION_TEMPLATE_DATA_ROWS + 1}`, {
    type: "list", allowBlank: false, formulae: [`"${PAYMENT_REQUEST_ENTITY_LABELS.join(",")}"`],
  });
  const taxTypeCol = colLetter(REGISTRATION_TEMPLATE_HEADERS.indexOf("청구방식") + 1);
  dataValidations.add(`${taxTypeCol}2:${taxTypeCol}${REGISTRATION_TEMPLATE_DATA_ROWS + 1}`, {
    type: "list", allowBlank: true, formulae: [`"${TAX_TYPE_LABELS.join(",")}"`],
  });

  await ws.protect("", {});
  return Buffer.from(await wb.xlsx.writeBuffer());
}
