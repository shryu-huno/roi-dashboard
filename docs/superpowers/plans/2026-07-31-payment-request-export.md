# 지급요청 목록 엑셀 다운로드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/expenses` 지급요청 탭의 "📗 엑셀 다운로드" 버튼(현재 스텁)을 구현해, 정산담당자/관리자가 등록된 지급요청을 PM 등록 정보 + 연동된 지급 리스트(Payee) 정보를 합쳐 엑셀로 다운로드할 수 있게 한다.

**Architecture:** 데이터 계층에 `PaymentRequest`↔`Payee` 조인 조회 함수를 추가하고, `exceljs`로 기존 지급 리스트 다운로드와 동일한 스타일의 워크북을 생성하는 별도 xlsx 빌더를 만들고, GET 라우트로 응답한 뒤, 화면 버튼을 그 라우트로 연결한다. 지급 리스트 다운로드(`payees/export/route.ts`, `payees/xlsx.ts`)의 기존 패턴을 그대로 미러링한다.

**Tech Stack:** Next.js App Router (route handler), Prisma, exceljs, vitest.

## Global Constraints

- 다운로드 버튼/라우트는 `ADMIN`/`SETTLEMENT` 역할만 접근 가능 (`requireRole("SETTLEMENT")`).
- 사업자번호·계좌번호는 마스킹이 아닌 복호화 원문으로 포함한다.
- 사업자명(이름)·청구방식은 `PaymentRequest`에 저장된 등록 시점 스냅샷 값을 사용한다 — 연동된 `Payee`의 최신값으로 재조회하지 않는다.
- `payeeId`가 없는 건은 지급 리스트 연동 컬럼(고유번호/연락처/사업자번호/은행명/계좌번호/예금주)을 빈 문자열로 채운다.
- 다운로드 범위: 체크박스 선택 있으면 선택 건만(검색/필터 무시), 없으면 현재 검색/필터 조건에 맞는 전체 결과(페이지네이션 무시, DB 전체 조회).
- 컬럼 순서(18열, 고정): `번호, 신청인, 지급명의, 고객사명, 사업자명(이름), 고유번호, 연락처, 사업자번호(주민등록번호), 은행명, 계좌번호, 예금주, 단가, 교통비, 재료비, 횟수, 총지급액, 청구방식, 상세내역`
- 금액 컬럼(단가/교통비/재료비/횟수/총지급액)은 천단위 콤마 서식(`numFmt: "#,##0"`), 사업자번호·계좌번호는 텍스트 서식(`numFmt: "@"`).
- 파일명: `지급요청리스트_YYYYMMDD.xlsx` (KST 기준).
- 참고 스펙: `docs/superpowers/specs/2026-07-31-payment-request-export-design.md`

---

### Task 1: 데이터 계층 — `listPaymentRequestsForExport`

**Files:**
- Modify: `src/lib/data/payment-requests.ts`
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: 기존 `buildWhere(filter?: PaymentRequestFilter)`(파일 내부 private 함수, 67~81행), `withRLS`, `decrypt`(신규 import, `@/lib/crypto/payee-secret`).
- Produces:
  ```ts
  export type PaymentRequestExportRow = {
    requesterName: string;
    entity: PaymentRequestEntity;
    clientName: string;
    bizName: string;
    payeeKeyId: string;
    phone: string;
    bizNumber: string;
    bankName: string;
    accountNumber: string;
    accountHolder: string;
    unitPrice: number;
    transportFee: number;
    materialFee: number;
    count: number;
    amount: number;
    taxType: TaxType;
    memo: string;
  };

  export function listPaymentRequestsForExport(
    ctx: RlsContext,
    filter?: PaymentRequestFilter,
    ids?: string[],
  ): Promise<PaymentRequestExportRow[]>
  ```
  Task 3(라우트)이 이 함수와 타입을 그대로 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-requests.test.ts` 맨 위 import에 `listPaymentRequestsForExport`를 추가:

```ts
import {
  listPaymentRequests, parsePaymentRequestPage, parsePaymentRequestEntity,
  parsePaymentRequestStatus, parsePaymentRequestDateParam, PAYMENT_REQUEST_PAGE_SIZE,
  createPaymentRequestsBulk, listPaymentRequestsForExport,
} from "@/lib/data/payment-requests";
```

파일 맨 끝(마지막 `describe`/`it` 블록들이 끝나는 지점, 최상위 `describe("payment-requests 데이터 계층", ...)` 블록의 닫는 `});` 바로 앞)에 아래 `describe` 블록을 추가한다. 기존 `seed`/`createPayee`/`baseInput`/`ADMIN`/`withRLS` 헬퍼를 그대로 재사용한다:

```ts
  describe("listPaymentRequestsForExport", () => {
    it("ids가 있으면 필터를 무시하고 해당 건만 반환한다", async () => {
      const { pmA, clientA } = await seed();
      const r1 = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건", status: "PREPARING" }),
      }));
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건", status: "COMPLETED" }),
      }));

      const rows = await listPaymentRequestsForExport(ADMIN, { status: "COMPLETED" }, [r1.id]);
      expect(rows.map((r) => r.bizName)).toEqual(["A건"]);
    });

    it("ids 없이 필터만 지정하면 페이지네이션 없이 필터링된 전체 결과를 반환한다", async () => {
      const { pmA, clientA } = await seed();
      for (let i = 0; i < PAYMENT_REQUEST_PAGE_SIZE + 1; i++) {
        await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
          data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: `건${i}` }),
        }));
      }
      const rows = await listPaymentRequestsForExport(ADMIN, { clientId: clientA.id });
      expect(rows).toHaveLength(PAYMENT_REQUEST_PAGE_SIZE + 1);
    });

    it("연동된 Payee의 지급 리스트 정보를 원문으로 포함한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1101234567", "김강사", "BUSINESS_INCOME");
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "김강사" }), payeeId: payee.id },
      }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.payeeKeyId).toBe(payee.keyId);
      expect(row.phone).toBe("010-1234-5678");
      expect(row.bizNumber).toBe("1101234567");
      expect(row.bankName).toBe("국민");
      expect(row.accountNumber).toBe("110123456789");
      expect(row.accountHolder).toBe("예금주");
    });

    it("payeeId가 없는 건은 지급 리스트 연동 컬럼이 빈 문자열이다", async () => {
      const { pmA, clientA } = await seed();
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "예외건" }),
      }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.payeeKeyId).toBe("");
      expect(row.phone).toBe("");
      expect(row.bizNumber).toBe("");
      expect(row.bankName).toBe("");
      expect(row.accountNumber).toBe("");
      expect(row.accountHolder).toBe("");
    });

    it("사업자명·청구방식은 등록 시점 스냅샷을 그대로 사용한다(Payee 최신값 아님)", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1101234567", "김강사", "TAX_INVOICE");
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: {
          ...baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "등록당시이름", taxType: "BUSINESS_INCOME" }),
          payeeId: payee.id,
        },
      }));
      await withRLS(ADMIN, (tx) => tx.payee.update({ where: { id: payee.id }, data: { bizName: "바뀐이름", taxType: "TAX_INVOICE" } }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.bizName).toBe("등록당시이름");
      expect(row.taxType).toBe("BUSINESS_INCOME");
    });
  });
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: FAIL — `listPaymentRequestsForExport` is not exported / not a function.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payment-requests.ts` 맨 위 import에 `decrypt` 추가:

```ts
import type { PaymentRequestEntity, PaymentRequestStatus, Prisma, TaxType } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";
import type { PaymentRequestCreateInput } from "@/lib/payment-request-validation";
import { decrypt } from "@/lib/crypto/payee-secret";
```

`listPaymentRequests` 함수 정의(현재 85~134행) 바로 뒤, `createPaymentRequestsBulk` 정의 바로 앞에 아래 타입과 함수를 추가한다:

```ts
export type PaymentRequestExportRow = {
  requesterName: string;
  entity: PaymentRequestEntity;
  clientName: string;
  bizName: string;
  payeeKeyId: string;
  phone: string;
  bizNumber: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  amount: number;
  taxType: TaxType;
  memo: string;
};

// 엑셀 다운로드 전용. ids가 있으면 필터 없이 해당 건만(체크박스 선택), 없으면 필터링된 전체
// 결과를 페이지네이션 없이 반환한다. 사업자명/청구방식은 PaymentRequest 스냅샷을 그대로 쓰고,
// 나머지 지급 리스트 정보(고유번호/연락처/사업자번호/은행명/계좌번호/예금주)만 연동된 Payee에서
// 조회한다 — payeeId가 없는 건은 빈 문자열로 채운다. role 체크는 호출부(export 라우트)가 담당한다.
export async function listPaymentRequestsForExport(
  ctx: RlsContext,
  filter?: PaymentRequestFilter,
  ids?: string[],
): Promise<PaymentRequestExportRow[]> {
  const where: Prisma.PaymentRequestWhereInput = ids && ids.length > 0
    ? { id: { in: ids }, deletedAt: null }
    : buildWhere(filter);

  const rows = await withRLS(ctx, (tx) => tx.paymentRequest.findMany({
    where,
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    include: {
      requester: { select: { name: true, email: true } },
      client: { select: { name: true } },
      payee: { select: { keyId: true, phone: true, bizNumberEnc: true, bankName: true, accountNumberEnc: true, accountHolder: true } },
    },
  }));

  return rows.map((r) => ({
    requesterName: r.requester.name ?? r.requester.email,
    entity: r.entity,
    clientName: r.client.name,
    bizName: r.bizName,
    payeeKeyId: r.payee?.keyId ?? "",
    phone: r.payee?.phone ?? "",
    bizNumber: r.payee ? decrypt(r.payee.bizNumberEnc) : "",
    bankName: r.payee?.bankName ?? "",
    accountNumber: r.payee ? decrypt(r.payee.accountNumberEnc) : "",
    accountHolder: r.payee?.accountHolder ?? "",
    unitPrice: r.unitPrice,
    transportFee: r.transportFee,
    materialFee: r.materialFee,
    count: r.count,
    amount: r.amount,
    taxType: r.taxType,
    memo: r.memo,
  }));
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: PASS (전체 테스트, 기존 케이스 포함 모두 통과).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat(payment-request): 엑셀 다운로드용 listPaymentRequestsForExport 데이터 계층 함수 추가"
```

---

### Task 2: 엑셀 빌더 — `buildPaymentRequestExportXlsxBuffer`

**Files:**
- Create: `src/app/(app)/expenses/payment-request/xlsx.ts`
- Test: `test/payment-request-xlsx.test.ts`

**Interfaces:**
- Consumes: `PaymentRequestExportRow`(Task 1), `paymentRequestEntityLabel`/`taxTypeLabel`(`@/lib/labels`, 기존).
- Produces:
  ```ts
  export const EXPORT_HEADERS: readonly string[]; // 18개 헤더, 정확한 순서
  export function buildPaymentRequestExportXlsxBuffer(rows: PaymentRequestExportRow[]): Promise<Buffer>
  ```
  Task 3(라우트)이 `buildPaymentRequestExportXlsxBuffer`를 그대로 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payment-request-xlsx.test.ts` 신규 생성. 파싱은 기존 `payees/xlsx.ts`의 `parseXlsxToRows`를 재사용한다(신규 로직 아님, 워크북 파서는 공통):

```ts
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run test/payment-request-xlsx.test.ts`
Expected: FAIL — `Cannot find module '@/app/(app)/expenses/payment-request/xlsx'`.

- [ ] **Step 3: 최소 구현 작성**

`src/app/(app)/expenses/payment-request/xlsx.ts` 신규 생성:

```ts
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
  EXPORT_HEADERS.forEach((header, i) => {
    const candidates = [header, ...dataRows.map((row) => String(row[i]))];
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
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run test/payment-request-xlsx.test.ts`
Expected: PASS (4개 테스트 모두).

- [ ] **Step 5: 커밋**

```bash
git add src/app/"(app)"/expenses/payment-request/xlsx.ts test/payment-request-xlsx.test.ts
git commit -m "feat(payment-request): 엑셀 다운로드 워크북 빌더 buildPaymentRequestExportXlsxBuffer 추가"
```

---

### Task 3: 다운로드 라우트 — `payment-request/export/route.ts`

**Files:**
- Create: `src/app/(app)/expenses/payment-request/export/route.ts`

**Interfaces:**
- Consumes: `listPaymentRequestsForExport`(Task 1), `buildPaymentRequestExportXlsxBuffer`(Task 2), `requireRole`(`@/lib/auth/session`, 기존), `getRlsContext`(`@/lib/context`, 기존), `parsePaymentRequestEntity`/`parsePaymentRequestStatus`/`parsePaymentRequestDateParam`(`@/lib/data/payment-requests`, 기존).
- Produces: `GET /expenses/payment-request/export?ids=...` 또는 `?payDateFrom=&payDateTo=&clientId=&entity=&status=&bizName=` — xlsx 파일 응답. Task 4가 이 경로로 링크를 건다.

이 라우트는 기존 저장소에 라우트 전용 단위테스트가 없는 패턴(`payees/export/route.ts`도 테스트 없음)을 따르므로, 타입 체크 + 수동 검증으로 확인한다.

- [ ] **Step 1: 라우트 파일 작성**

`src/app/(app)/expenses/payment-request/export/route.ts` 신규 생성:

```ts
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import {
  listPaymentRequestsForExport, parsePaymentRequestEntity, parsePaymentRequestStatus, parsePaymentRequestDateParam,
} from "@/lib/data/payment-requests";
import { buildPaymentRequestExportXlsxBuffer } from "../xlsx";

export const runtime = "nodejs";

// 지급요청 목록 엑셀 다운로드. ids가 있으면 체크박스로 선택한 항목만(검색/필터 무시),
// 없으면 현재 검색/필터 결과 전체(페이지네이션 무시)를 내려받는다. ADMIN·SETTLEMENT 전용,
// 사업자번호·계좌번호는 마스킹이 아닌 원문으로 포함한다.
export async function GET(req: NextRequest) {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);

  const sp = req.nextUrl.searchParams;
  const idsParam = sp.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];

  const rows = ids.length > 0
    ? await listPaymentRequestsForExport(ctx, undefined, ids)
    : await listPaymentRequestsForExport(ctx, {
      payDateFrom: parsePaymentRequestDateParam(sp.get("payDateFrom") ?? undefined),
      payDateTo: parsePaymentRequestDateParam(sp.get("payDateTo") ?? undefined),
      clientId: sp.get("clientId") || undefined,
      entity: parsePaymentRequestEntity(sp.get("entity") ?? undefined),
      status: parsePaymentRequestStatus(sp.get("status") ?? undefined),
      bizName: sp.get("bizName") || undefined,
    });

  const buf = await buildPaymentRequestExportXlsxBuffer(rows);

  const kstDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).replaceAll("-", "");
  const filename = encodeURIComponent(`지급요청리스트_${kstDate}.xlsx`);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 이 라우트 관련 에러 없음(프로젝트에 기존에 있던 무관한 에러가 있다면 이번 변경으로 늘지 않았는지만 확인).

- [ ] **Step 3: 커밋**

```bash
git add src/app/"(app)"/expenses/payment-request/export/route.ts
git commit -m "feat(payment-request): 엑셀 다운로드 GET 라우트 추가"
```

---

### Task 4: 화면 연동 — `PaymentRequestListPanel` 다운로드 버튼

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestListPanel.tsx:117-122`

**Interfaces:**
- Consumes: Task 3의 `GET /expenses/payment-request/export` 라우트. 화면이 이미 갖고 있는 `selected`(체크박스 선택된 `PaymentRequest.id` Set, 47행)와 `filterParams`(66~73행)를 그대로 사용한다.
- Produces: 없음(최종 사용자 화면 변경).

- [ ] **Step 1: `exportHref` 계산 추가**

`src/app/(app)/expenses/PaymentRequestListPanel.tsx`에서 `filterParams` 정의(66~73행) 바로 뒤에 아래를 추가:

```tsx
  // 체크된 행이 있으면 그 항목만, 없으면 현재 검색/필터 결과 전체를 다운로드 대상으로 삼는다.
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const exportHref = selectedIds.length > 0
    ? `/expenses/payment-request/export?ids=${encodeURIComponent(selectedIds.join(","))}`
    : `/expenses/payment-request/export?${new URLSearchParams(filterParams).toString()}`;
```

- [ ] **Step 2: 다운로드 버튼을 실제 링크로 교체**

기존(117~122행):

```tsx
        {canExport && (
          <button type="button" onClick={() => alert(NOT_IMPLEMENTED)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            📗 엑셀 다운로드
          </button>
        )}
```

교체 후:

```tsx
        {canExport && (
          rows.length > 0 ? (
            <a href={exportHref} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
              📗 엑셀 다운로드{selectedIds.length > 0 ? ` (${selectedIds.length}건 선택)` : ""}
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="다운로드할 데이터가 없습니다"
              className="cursor-not-allowed rounded border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] opacity-50"
            >
              📗 엑셀 다운로드
            </button>
          )
        )}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 에러 없음.

- [ ] **Step 4: 전체 테스트 스위트 실행**

Run: `npx vitest run`
Expected: 전체 PASS(기존 스위트 + Task 1/2에서 추가한 테스트 포함).

- [ ] **Step 5: 수동 검증**

1. `npm run dev`로 앱 실행, `SETTLEMENT` 또는 `ADMIN` 계정으로 로그인 후 `/expenses` → "지급요청" 탭 이동.
2. 체크박스 선택 없이 "📗 엑셀 다운로드" 클릭 → 현재 검색/필터 결과 전체가 담긴 `지급요청리스트_YYYYMMDD.xlsx`가 다운로드되는지 확인.
3. 컬럼 순서(번호~상세내역 18열), 사업자번호/계좌번호가 선행 0 손실 없이 원문으로, 단가/교통비/재료비/횟수/총지급액이 천단위 콤마로 표시되는지 확인.
4. 체크박스로 1~2건 선택 후 다운로드 → 선택한 건만 포함되는지 확인.
5. 검색/필터(고객사, 지급여부 등) 적용 후 선택 없이 다운로드 → 필터링된 전체 결과가 페이지 수와 무관하게 모두 포함되는지 확인.
6. 검색 결과 0건일 때 다운로드 버튼이 비활성화되는지 확인.
7. PM 계정으로 로그인해 다운로드 버튼 자체가 보이지 않는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/app/"(app)"/expenses/PaymentRequestListPanel.tsx
git commit -m "feat(payment-request): 엑셀 다운로드 버튼을 실제 라우트로 연결"
```
