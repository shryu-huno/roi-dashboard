import { describe, it, expect } from "vitest";
import { parseXlsxToRows } from "@/app/(app)/expenses/payees/xlsx";
import {
  buildPaymentRequestExportXlsxBuffer,
  buildPaymentRequestRegistrationTemplateXlsxBuffer,
  EXPORT_HEADERS,
} from "@/app/(app)/expenses/payment-request/xlsx";
import type { PaymentRequestExportRow } from "@/lib/data/payment-requests";
import { buildPaymentRequestUpdatesFromRows } from "@/lib/data/payment-request-upload";
import { REGISTRATION_TEMPLATE_HEADERS } from "@/lib/data/payment-request-registration-upload";

describe("payment-request export xlsx", () => {
  const row: PaymentRequestExportRow = {
    seqNo: 1,
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
    payDate: new Date("2026-08-05"),
    status: "COMPLETED",
  };

  it("헤더와 데이터 행이 지정된 컬럼 순서와 일치한다", async () => {
    const buf = await buildPaymentRequestExportXlsxBuffer([row]);
    const rows = await parseXlsxToRows(buf);
    expect(rows[0]).toEqual([...EXPORT_HEADERS]);
    expect(rows[1]).toEqual([
      "1", "김PM", "휴노", "A사", "홍길동", "a001", "010-1234-5678",
      "9001011234567", "국민은행", "110123456789", "홍길동",
      "100000", "10000", "0", "2", "220000", "사업소득", "8월 진행분",
      "2026-08-05", "지급완료",
    ]);
  });

  it("행이 없으면 헤더만 있는 파일이 생성된다", async () => {
    const buf = await buildPaymentRequestExportXlsxBuffer([]);
    const rows = await parseXlsxToRows(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([...EXPORT_HEADERS]);
  });

  it("사업자번호·계좌번호·지급일은 텍스트 서식, 금액 컬럼은 콤마 서식이다", async () => {
    const buf = await buildPaymentRequestExportXlsxBuffer([row]);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    const bizNumberCol = EXPORT_HEADERS.indexOf("사업자번호(주민등록번호)") + 1;
    const accountCol = EXPORT_HEADERS.indexOf("계좌번호") + 1;
    const amountCol = EXPORT_HEADERS.indexOf("총지급액") + 1;
    const payDateCol = EXPORT_HEADERS.indexOf("지급일") + 1;
    expect(ws.getColumn(bizNumberCol).numFmt).toBe("@");
    expect(ws.getColumn(accountCol).numFmt).toBe("@");
    expect(ws.getColumn(amountCol).numFmt).toBe("#,##0");
    expect(ws.getColumn(payDateCol).numFmt).toBe("@");
  });

  it("No는 seqNo 값, 지급명의/청구방식/지급여부는 한글 라벨로 변환된다", async () => {
    const rows2: PaymentRequestExportRow[] = [
      row,
      { ...row, seqNo: 42, entity: "HUNO_INC", taxType: "TAX_INVOICE", bizName: "김철수", status: "PREPARING", payDate: null },
    ];
    const buf = await buildPaymentRequestExportXlsxBuffer(rows2);
    const parsed = await parseXlsxToRows(buf);
    expect(parsed[1][0]).toBe("1");
    expect(parsed[2][0]).toBe("42");
    expect(parsed[2][2]).toBe("휴노INC");
    expect(parsed[2][16]).toBe("세금계산서");
    expect(parsed[2][18]).toBe("");
    expect(parsed[2][19]).toBe("지급준비");
  });

  it("긴 상세내역은 열 너비를 60 이하로 제한한다", async () => {
    const longMemo = "가".repeat(200);
    const rowWithLongMemo = { ...row, memo: longMemo };
    const buf = await buildPaymentRequestExportXlsxBuffer([rowWithLongMemo]);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    const memoCol = EXPORT_HEADERS.indexOf("상세내역") + 1;
    expect(ws.getColumn(memoCol).width).toBeLessThanOrEqual(60);
  });

  it("내보낸 파일을 그대로 재업로드 파서에 넣으면 원본 값으로 왕복된다(헤더 문자열 드리프트 회귀 방지)", async () => {
    const buf = await buildPaymentRequestExportXlsxBuffer([row]);
    const rows = await parseXlsxToRows(buf);
    const { updates, errors } = buildPaymentRequestUpdatesFromRows(rows);
    expect(errors).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0].seqNo).toBe(row.seqNo);
    expect(updates[0].status).toBe(row.status);
    expect(updates[0].payDate).toEqual(row.payDate);
  });

  it("지급여부 컬럼에 드롭다운 유효성 검사가 걸려있다", async () => {
    const buf = await buildPaymentRequestExportXlsxBuffer([row]);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    const statusCol = EXPORT_HEADERS.indexOf("지급여부") + 1;
    const dv = ws.getCell(2, statusCol).dataValidation;
    expect(dv?.type).toBe("list");
    expect(dv?.formulae?.[0]).toContain("지급준비");
    expect(dv?.formulae?.[0]).toContain("지급완료");
  });
});

describe("payment-request registration template xlsx", () => {
  it("헤더 15개가 지정된 순서로 생성된다", async () => {
    const buf = await buildPaymentRequestRegistrationTemplateXlsxBuffer();
    const rows = await parseXlsxToRows(buf);
    expect(rows[0]).toEqual([...REGISTRATION_TEMPLATE_HEADERS]);
  });

  it("사업자번호·계좌번호 컬럼은 텍스트 서식이다", async () => {
    const buf = await buildPaymentRequestRegistrationTemplateXlsxBuffer();
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    expect(ws.getColumn(REGISTRATION_TEMPLATE_HEADERS.indexOf("사업자번호(주민등록번호)") + 1).numFmt).toBe("@");
    expect(ws.getColumn(REGISTRATION_TEMPLATE_HEADERS.indexOf("계좌번호") + 1).numFmt).toBe("@");
  });

  it("지급명의/청구방식 컬럼에 드롭다운(목록 유효성 검사)이 적용된다", async () => {
    const buf = await buildPaymentRequestRegistrationTemplateXlsxBuffer();
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    const entityCol = REGISTRATION_TEMPLATE_HEADERS.indexOf("지급명의") + 1;
    const taxTypeCol = REGISTRATION_TEMPLATE_HEADERS.indexOf("청구방식") + 1;
    const entityCell = ws.getCell(2, entityCol);
    const taxTypeCell = ws.getCell(2, taxTypeCol);
    expect(entityCell.dataValidation?.type).toBe("list");
    expect(taxTypeCell.dataValidation?.type).toBe("list");
  });
});
