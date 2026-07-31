import ExcelJS from "exceljs";
import { TAX_TYPE_LABELS, taxTypeLabel } from "@/lib/labels";
import type { PayeeExportRow } from "@/lib/data/payees";

// 서식·업로드 공통 컬럼 순서. keyId는 자동 채번이라 서식에 없음.
export const TEMPLATE_HEADERS = [
  "사업자명(이름)", "사업자번호(주민등록번호)", "연락처", "은행명", "계좌번호", "예금주", "청구방식",
] as const;

const TEMPLATE_DATA_ROWS = 1000; // 청구방식 드롭다운·서식(정렬/테두리)을 미리 적용해둘 행 수

// 열 너비 계산용 — 한글(전각) 1자를 폭 2로, 그 외 1자를 폭 1로 취급.
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    width += code >= 0xac00 && code <= 0xd7a3 ? 2 : 1;
  }
  return width;
}

// 1-based 컬럼 번호 → 엑셀 열 문자(A, B, C, ...). 서식 컬럼이 7개뿐이라 A~Z 범위로 충분.
function colLetter(colNumber: number): string {
  return String.fromCharCode("A".charCodeAt(0) + colNumber - 1);
}

// 하이픈·공백을 제거한 값이 숫자이고 길이가 허용 자릿수 목록 중 하나인지 검사하는
// 데이터 유효성 검사용 커스텀 수식. Excel이 range 내 각 셀에 상대참조로 자동 적용한다.
function digitsLengthFormula(cellRef: string, lengths: number[]): string {
  const digits = `SUBSTITUTE(SUBSTITUTE(${cellRef},"-","")," ","")`;
  const lenChecks = lengths.map((n) => `LEN(${digits})=${n}`).join(",");
  return `AND(ISNUMBER(VALUE(${digits})),OR(${lenChecks}))`;
}

// Date 타입 셀은 화면 표시 서식(로캘/포맷)에 좌우되지 않도록 UTC 연/월/일을 직접 조합한다.
// exceljs는 Excel 날짜 직렬값을 타임존 없이 그대로 UTC Date로 해석하므로, UTC 컴포넌트가
// 곧 사용자가 입력한 달력일과 일치한다.
function formatUtcDateAsIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 첫 워크시트를 문자열 2차원 배열로 변환(헤더 컬럼 수만큼 정렬 유지, 셀은 표시 텍스트).
export async function parseXlsxToRows(buf: Buffer | ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs 타입 정의가 로컬 Buffer(ArrayBuffer 확장)를 선언해 전역 Node Buffer와 어긋난다 — unknown 경유로 우회.
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const colCount = ws.columnCount;
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      const text =
        cell.type === ExcelJS.ValueType.Date && cell.value instanceof Date
          ? formatUtcDateAsIsoDate(cell.value)
          : (cell.text ?? "").toString();
      cells.push(text);
    }
    rows.push(cells);
  }
  return rows;
}

// 헤더 셀에 달아둘 작성 안내 메모.
const HEADER_NOTES: Record<(typeof TEMPLATE_HEADERS)[number], string> = {
  "사업자명(이름)": "사업자명(업체) 또는 강사 이름을 입력하세요.",
  "사업자번호(주민등록번호)": "사업자등록번호(10자리) 또는 주민등록번호(13자리). 하이픈(-) 포함 가능.",
  "연락처": "숫자 9~11자리. 하이픈(-) 포함 가능. 예: 010-1234-5678",
  "은행명": "예: 국민은행, 신한은행",
  "계좌번호": "숫자 10~16자리. 하이픈(-) 포함 가능.",
  "예금주": "계좌 명의자명을 입력하세요.",
  "청구방식": "드롭다운에서 선택: 세금계산서/면세계산서/현금영수증/수기계산서/사업소득/기타소득",
};

// 헤더 + 드롭다운 적용 범위(TEMPLATE_DATA_ROWS행)까지 정렬·테두리·열너비를 갖춘 서식 워크북 버퍼.
export async function buildTemplateXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("지급리스트");
  ws.addRow([...TEMPLATE_HEADERS]);
  // 사업자번호·계좌번호 등 숫자 문자열의 선행 0/자릿수 손실 방지 — 데이터 컬럼을 텍스트 서식으로.
  for (let c = 1; c <= TEMPLATE_HEADERS.length; c++) {
    ws.getColumn(c).numFmt = "@";
  }
  // 열 너비 — 헤더 텍스트(청구방식은 드롭다운 항목 중 가장 긴 값도 함께) 기준 자동 계산.
  const COLUMN_WIDTH_PADDING = 4;
  TEMPLATE_HEADERS.forEach((header, i) => {
    const candidates = header === "청구방식" ? [header, ...TAX_TYPE_LABELS] : [header];
    ws.getColumn(i + 1).width = Math.max(...candidates.map(displayWidth)) + COLUMN_WIDTH_PADDING;
  });
  // 헤더 행 고정 — 아래로 스크롤해도 1행이 항상 보이도록.
  ws.views = [{ state: "frozen", ySplit: 1 }];
  // 헤더~드롭다운 적용 범위(1~TEMPLATE_DATA_ROWS+1행)에 가운데 정렬 + 테두리 적용.
  // 헤더 행은 굵게 + 옅은 배경색으로 강조하고 잠금 유지, 데이터 행은 잠금 해제해
  // 시트 보호를 걸어도 값 입력은 가능하게 한다.
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
  };
  for (let r = 1; r <= TEMPLATE_DATA_ROWS + 1; r++) {
    const isHeader = r === 1;
    for (let c = 1; c <= TEMPLATE_HEADERS.length; c++) {
      const cell = ws.getCell(r, c);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder;
      cell.protection = { locked: isHeader };
      if (isHeader) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
        cell.note = HEADER_NOTES[TEMPLATE_HEADERS[c - 1]];
      }
    }
  }
  // exceljs 타입 정의에 Worksheet.dataValidations가 누락돼 있어 unknown 경유로 우회.
  const dataValidations = (ws as unknown as {
    dataValidations: { add: (address: string, dv: ExcelJS.DataValidation) => void };
  }).dataValidations;
  // 청구방식 컬럼에 드롭다운(목록 유효성 검사) 적용.
  const taxTypeCol = colLetter(TEMPLATE_HEADERS.indexOf("청구방식") + 1);
  dataValidations.add(`${taxTypeCol}2:${taxTypeCol}${TEMPLATE_DATA_ROWS + 1}`, {
    type: "list",
    allowBlank: true,
    formulae: [`"${TAX_TYPE_LABELS.join(",")}"`],
  });
  // 사업자번호·계좌번호 컬럼에 숫자·자릿수 검증(하이픈/공백 무시) 적용.
  const bizNumberCol = colLetter(TEMPLATE_HEADERS.indexOf("사업자번호(주민등록번호)") + 1);
  dataValidations.add(`${bizNumberCol}2:${bizNumberCol}${TEMPLATE_DATA_ROWS + 1}`, {
    type: "custom",
    allowBlank: true,
    formulae: [digitsLengthFormula(`${bizNumberCol}2`, [10, 13])],
    showErrorMessage: true,
    errorStyle: "error",
    errorTitle: "형식 오류",
    error: "숫자 10자리(사업자번호) 또는 13자리(주민등록번호)로 입력하세요. 하이픈(-) 포함 가능.",
  });
  const accountCol = colLetter(TEMPLATE_HEADERS.indexOf("계좌번호") + 1);
  dataValidations.add(`${accountCol}2:${accountCol}${TEMPLATE_DATA_ROWS + 1}`, {
    type: "custom",
    allowBlank: true,
    formulae: [digitsLengthFormula(`${accountCol}2`, [10, 11, 12, 13, 14, 15, 16])],
    showErrorMessage: true,
    errorStyle: "error",
    errorTitle: "형식 오류",
    error: "숫자 10~16자리로 입력하세요. 하이픈(-) 포함 가능.",
  });
  // 헤더 행만 잠긴 채로 시트 보호 — 데이터 행은 값 입력·삭제 가능.
  await ws.protect("", {});
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// 검색/필터 적용된 지급 리스트 다운로드용 컬럼 순서. 화면 테이블 헤더와 동일한 순서로 맞춘다.
export const EXPORT_HEADERS = [
  "고유번호", "사업자명(이름)", "사업자번호(주민등록번호)", "연락처", "은행명",
  "계좌번호", "예금주", "청구방식", "사업자등록증 첨부", "통장사본 첨부",
] as const;

// 검색 결과를 그대로 내려받는 다운로드용 워크북. 등록 서식과 달리 읽기 전용 결과물이라
// 드롭다운·유효성검사·메모·시트보호는 넣지 않는다.
export async function buildExportXlsxBuffer(rows: PayeeExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("지급리스트");

  const dataRows = rows.map((r) => [
    r.keyId,
    r.bizName,
    r.bizNumber,
    r.phone,
    r.bankName,
    r.accountNumber,
    r.accountHolder,
    taxTypeLabel(r.taxType),
    r.hasBizCert ? "O" : "X",
    r.hasBankbook ? "O" : "X",
  ]);
  ws.addRow([...EXPORT_HEADERS]);
  dataRows.forEach((row) => ws.addRow(row));

  // 사업자번호·계좌번호는 텍스트 서식으로 — 선행 0/자릿수 손실 방지.
  const TEXT_COLUMNS = ["사업자번호(주민등록번호)", "계좌번호"] as const;
  TEXT_COLUMNS.forEach((header) => {
    ws.getColumn(EXPORT_HEADERS.indexOf(header) + 1).numFmt = "@";
  });

  // 열 너비 — 헤더와 실제 데이터 중 가장 넓은 값 기준.
  const COLUMN_WIDTH_PADDING = 4;
  EXPORT_HEADERS.forEach((header, i) => {
    const candidates = [header, ...dataRows.map((row) => row[i])];
    ws.getColumn(i + 1).width = Math.max(...candidates.map(displayWidth)) + COLUMN_WIDTH_PADDING;
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

  return Buffer.from(await wb.xlsx.writeBuffer());
}
