import ExcelJS from "exceljs";
import { paymentRequestEntityLabel, taxTypeLabel } from "@/lib/labels";
import type { PaymentRequestExportRow } from "@/lib/data/payment-requests";

// 열 너비 계산용 — 한글(전각) 1자를 폭 2로, 그 외 1자를 폭 1로 취급.
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    width += code >= 0xac00 && code <= 0xd7a3 ? 2 : 1;
  }
  return width;
}

// 화면 목록의 컬럼 + 지급 리스트 연동 컬럼을 합친 다운로드 전용 컬럼 순서.
export const EXPORT_HEADERS = [
  "번호", "신청인", "지급명의", "고객사명", "사업자명(이름)", "고유번호", "연락처",
  "사업자번호(주민등록번호)", "은행명", "계좌번호", "예금주", "단가", "교통비",
  "재료비", "횟수", "총지급액", "청구방식", "상세내역",
] as const;

const TEXT_COLUMNS = ["사업자번호(주민등록번호)", "계좌번호"] as const;
const NUMBER_COLUMNS = ["단가", "교통비", "재료비", "횟수", "총지급액"] as const;

// 검색 결과를 그대로 내려받는 다운로드용 워크북. 읽기 전용 결과물이라
// 드롭다운·유효성검사·메모·시트보호는 넣지 않는다(지급 리스트 export와 동일한 방침).
export async function buildPaymentRequestExportXlsxBuffer(rows: PaymentRequestExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("지급요청리스트");

  const dataRows = rows.map((r, i) => [
    i + 1,
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
  ]);
  ws.addRow([...EXPORT_HEADERS]);
  dataRows.forEach((row) => ws.addRow(row));

  // 사업자번호·계좌번호는 텍스트 서식으로 — 선행 0/자릿수 손실 방지.
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

  return Buffer.from(await wb.xlsx.writeBuffer());
}
