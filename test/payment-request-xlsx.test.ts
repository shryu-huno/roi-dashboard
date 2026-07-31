import { describe, it, expect } from "vitest";
import { parseXlsxToRows } from "@/app/(app)/expenses/payees/xlsx";
import { buildPaymentRequestExportXlsxBuffer, EXPORT_HEADERS } from "@/app/(app)/expenses/payment-request/xlsx";
import type { PaymentRequestExportRow } from "@/lib/data/payment-requests";

describe("payment-request export xlsx", () => {
  const row: PaymentRequestExportRow = {
    requesterName: "김PM",
    entity: "HUNO",
    clientName: "A사",
    bizName: "홍길동",
    payeeKeyId: "a001",
    phone: "010-1234-5678",
    bizNumber: "9001011234567",
    bankName: "국민은행",
    accountNumber: "110123456789",
    accountHolder: "홍길동",
    unitPrice: 100000,
    transportFee: 10000,
    materialFee: 0,
    count: 2,
    amount: 220000,
    taxType: "BUSINESS_INCOME",
    memo: "8월 진행분",
  };

  it("헤더와 데이터 행이 지정된 컬럼 순서와 일치한다", async () => {
    const buf = await buildPaymentRequestExportXlsxBuffer([row]);
    const rows = await parseXlsxToRows(buf);
    expect(rows[0]).toEqual([...EXPORT_HEADERS]);
    expect(rows[1]).toEqual([
      "1", "김PM", "휴노", "A사", "홍길동", "a001", "010-1234-5678",
      "9001011234567", "국민은행", "110123456789", "홍길동",
      "100000", "10000", "0", "2", "220000", "사업소득", "8월 진행분",
    ]);
  });

  it("행이 없으면 헤더만 있는 파일이 생성된다", async () => {
    const buf = await buildPaymentRequestExportXlsxBuffer([]);
    const rows = await parseXlsxToRows(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([...EXPORT_HEADERS]);
  });

  it("사업자번호·계좌번호는 텍스트 서식, 금액 컬럼은 콤마 서식이다", async () => {
    const buf = await buildPaymentRequestExportXlsxBuffer([row]);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    const bizNumberCol = EXPORT_HEADERS.indexOf("사업자번호(주민등록번호)") + 1;
    const accountCol = EXPORT_HEADERS.indexOf("계좌번호") + 1;
    const amountCol = EXPORT_HEADERS.indexOf("총지급액") + 1;
    expect(ws.getColumn(bizNumberCol).numFmt).toBe("@");
    expect(ws.getColumn(accountCol).numFmt).toBe("@");
    expect(ws.getColumn(amountCol).numFmt).toBe("#,##0");
  });

  it("번호는 순번, 지급명의/청구방식은 한글 라벨로 변환된다", async () => {
    const rows2: PaymentRequestExportRow[] = [row, { ...row, entity: "HUNO_INC", taxType: "TAX_INVOICE", bizName: "김철수" }];
    const buf = await buildPaymentRequestExportXlsxBuffer(rows2);
    const parsed = await parseXlsxToRows(buf);
    expect(parsed[1][0]).toBe("1");
    expect(parsed[2][0]).toBe("2");
    expect(parsed[2][2]).toBe("휴노INC");
    expect(parsed[2][16]).toBe("세금계산서");
  });
});
