import { describe, it, expect } from "vitest";
import { parseXlsxToRows, buildTemplateXlsxBuffer, buildExportXlsxBuffer, TEMPLATE_HEADERS, EXPORT_HEADERS } from "@/app/(app)/expenses/payees/xlsx";
import type { PayeeExportRow } from "@/lib/data/payees";

describe("payee xlsx 유틸", () => {
  it("서식 버퍼는 헤더 행 + 서식 적용된 빈 데이터 행(총 1001행)으로 라운드트립된다", async () => {
    const buf = await buildTemplateXlsxBuffer();
    const rows = await parseXlsxToRows(buf);
    expect(rows[0]).toEqual([...TEMPLATE_HEADERS]);
    expect(rows).toHaveLength(1001);
    expect(rows[1]).toEqual(TEMPLATE_HEADERS.map(() => ""));
  });

  it("데이터 행을 문자열 2차원 배열로 읽는다(컬럼 정렬 유지)", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow([...TEMPLATE_HEADERS]);
    ws.addRow(["테스트업체", "123-45-67890", "010-1234-5678", "국민", "1101234567", "대표", "세금계산서"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseXlsxToRows(buf);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("테스트업체");
    expect(rows[1][6]).toBe("세금계산서");
  });

  it("서버액션의 file.arrayBuffer() 경로처럼 실제 ArrayBuffer 입력도 파싱한다", async () => {
    const buf = await buildTemplateXlsxBuffer();
    // Buffer가 아닌 순수 ArrayBuffer로 슬라이스 — 프로덕션에서 file.arrayBuffer()가 반환하는 타입과 동일.
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    expect(ab instanceof ArrayBuffer).toBe(true);
    const rows = await parseXlsxToRows(ab);
    expect(rows[0]).toEqual([...TEMPLATE_HEADERS]);
    expect(rows).toHaveLength(1001);
  });
});

describe("payee export xlsx", () => {
  const row: PayeeExportRow = {
    keyId: "b001",
    bizName: "테스트업체",
    bizNumber: "1234567890",
    phone: "010-1234-5678",
    bankName: "국민은행",
    accountNumber: "110123456789",
    accountHolder: "홍길동",
    taxType: "TAX_INVOICE",
    hasBizCert: true,
    hasBankbook: false,
  };

  it("헤더와 데이터 행이 화면 컬럼 순서와 일치한다", async () => {
    const buf = await buildExportXlsxBuffer([row]);
    const rows = await parseXlsxToRows(buf);
    expect(rows[0]).toEqual([...EXPORT_HEADERS]);
    expect(rows[1]).toEqual([
      "b001", "테스트업체", "1234567890", "010-1234-5678", "국민은행",
      "110123456789", "홍길동", "세금계산서", "O", "X",
    ]);
  });

  it("행이 없으면 헤더만 있는 파일이 생성된다", async () => {
    const buf = await buildExportXlsxBuffer([]);
    const rows = await parseXlsxToRows(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([...EXPORT_HEADERS]);
  });
});
