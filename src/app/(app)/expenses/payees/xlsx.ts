import ExcelJS from "exceljs";
import { TAX_TYPE_LABELS } from "@/lib/labels";

// 서식·업로드 공통 컬럼 순서. keyId는 자동 채번이라 서식에 없음.
export const TEMPLATE_HEADERS = [
  "사업자명(이름)", "사업자번호(주민등록번호)", "연락처", "은행명", "계좌번호", "예금주", "청구방식",
] as const;

const TEMPLATE_DATA_ROWS = 1000; // 청구방식 드롭다운을 미리 적용해둘 행 수

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
      cells.push((row.getCell(c).text ?? "").toString());
    }
    rows.push(cells);
  }
  return rows;
}

// 헤더 한 행만 있는 서식 워크북 버퍼.
export async function buildTemplateXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("지급리스트");
  ws.addRow([...TEMPLATE_HEADERS]);
  // 사업자번호·계좌번호 등 숫자 문자열의 선행 0/자릿수 손실 방지 — 데이터 컬럼을 텍스트 서식으로.
  for (let c = 1; c <= TEMPLATE_HEADERS.length; c++) {
    ws.getColumn(c).numFmt = "@";
  }
  // 청구방식 컬럼에 드롭다운(목록 유효성 검사) 적용. getCell을 쓰면 빈 셀도 실제 행으로 생성되어
  // rowCount가 늘어나므로, 워크시트 범위 API로 셀을 만들지 않고 유효성 검사만 등록한다.
  // exceljs 타입 정의에 Worksheet.dataValidations가 누락돼 있어 unknown 경유로 우회.
  const dataValidations = (ws as unknown as {
    dataValidations: { add: (address: string, dv: ExcelJS.DataValidation) => void };
  }).dataValidations;
  const taxTypeColLetter = String.fromCharCode(
    "A".charCodeAt(0) + TEMPLATE_HEADERS.indexOf("청구방식"),
  );
  dataValidations.add(`${taxTypeColLetter}2:${taxTypeColLetter}${TEMPLATE_DATA_ROWS + 1}`, {
    type: "list",
    allowBlank: true,
    formulae: [`"${TAX_TYPE_LABELS.join(",")}"`],
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
