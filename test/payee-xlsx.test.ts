import { describe, it, expect } from "vitest";
import { parseXlsxToRows, buildTemplateXlsxBuffer, TEMPLATE_HEADERS } from "@/app/(app)/expenses/payees/xlsx";

describe("payee xlsx 유틸", () => {
  it("서식 버퍼는 헤더 한 행으로 라운드트립된다", async () => {
    const buf = await buildTemplateXlsxBuffer();
    const rows = await parseXlsxToRows(buf);
    expect(rows[0]).toEqual([...TEMPLATE_HEADERS]);
    expect(rows).toHaveLength(1);
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
    expect(rows).toHaveLength(1);
  });
});
