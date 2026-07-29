# 지급 리스트 엑셀 다운로드 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지급 리스트 화면(`/expenses?tab=payment-list`)의 "📗 엑셀 다운로드" 버튼에 실제 다운로드 로직을 연결한다. 현재 화면(검색/필터 적용 상태)에 보이는 목록을 엑셀 파일로 내려받되, 사업자번호는 마스킹이 아닌 원문으로 포함한다.

**Architecture:** GET 라우트 핸들러(`payees/export/route.ts`)가 검색 폼과 동일한 쿼리 파라미터(`field`, `q`)를 받아 `listPayeesForExport`로 조회한 뒤 `exceljs`로 워크북을 만들어 `Content-Disposition: attachment`로 응답한다. 데이터 계층은 기존 `listPayees`와 조회/필터링 로직을 공유하되, 화면용(`PayeeRow`, 마스킹)과 다운로드용(`PayeeExportRow`, 사업자번호 원문 포함) 매핑만 분리한다.

**Tech Stack:** Next.js App Router (GET route handler), Prisma/PostgreSQL, exceljs, vitest.

## Global Constraints

- 다운로드 컬럼은 정확히 10개, 이 순서: 고유번호, 사업자명(이름), 사업자번호, 연락처, 은행명, 계좌번호, 예금주, 청구방식, 사업자등록증 첨부, 통장사본 첨부.
- 사업자번호·계좌번호는 다운로드 파일에 원문(복호화된 값)으로 포함한다. 화면용 `PayeeRow`/마스킹 로직은 건드리지 않는다.
- 파일명은 정확히 `지급리스트_YYYYMMDD.xlsx` (한국 시간 기준 날짜, 검색어는 파일명에 포함하지 않음).
- 다운로드 권한은 `requireRole("SETTLEMENT")`로 통일한다(ADMIN은 랭크상 자동 통과). 다른 role 체크 방식을 새로 만들지 않는다.
- 다운로드는 GET 라우트 링크 방식이며, 검색 폼의 `field`/`q` 쿼리 파라미터를 그대로 전달한다.
- 결과 0건일 때는 다운로드 버튼을 비활성화한다(별도 에러 응답/페이지는 만들지 않음).
- 감사 로그(다운로드 이력 기록)는 이번 범위에서 도입하지 않는다.
- 엑셀 스타일링은 기존 등록 서식(`buildTemplateXlsxBuffer`)과 동일한 수준(열너비 자동조정/헤더 굵게+배경색/테두리/헤더행 고정)으로 하되, 드롭다운·유효성검사·메모·시트보호는 넣지 않는다(읽기 전용 결과물).
- 페이지네이션은 도입하지 않는다(기존에도 없음).

---

## File Structure

- Modify: `src/lib/data/payees.ts` — `listPayees` 내부의 조회+필터링 로직을 `fetchMatchedPayees` 헬퍼로 분리, `PayeeExportRow` 타입과 `listPayeesForExport` 추가.
- Modify: `src/app/(app)/expenses/payees/xlsx.ts` — `buildExportXlsxBuffer` 추가.
- Create: `src/app/(app)/expenses/payees/export/route.ts` — 다운로드 GET 라우트.
- Modify: `src/app/(app)/expenses/PayeeListPanel.tsx` — 엑셀 다운로드 버튼을 링크(또는 0건 시 비활성 버튼)로 교체.
- Modify: `test/data-payees.test.ts` — `listPayeesForExport` 테스트 추가.
- Modify: `test/payee-xlsx.test.ts` — `buildExportXlsxBuffer` 테스트 추가.

---

### Task 1: 데이터 계층 — `fetchMatchedPayees` 분리 및 `listPayeesForExport` 추가

**Files:**
- Modify: `src/lib/data/payees.ts:33-46` (PayeeRow 타입 아래에 PayeeExportRow 추가), `src/lib/data/payees.ts:121-156` (listPayees 전체를 헬퍼 분리 버전으로 교체)
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Consumes: 기존 `withRLS`, `decrypt`, `digitsOnly`, `RlsContext`, `PayeeSearchFilter`, `Prisma`(이미 payees.ts 1행에서 import됨)
- Produces:
  - `export type PayeeExportRow = { keyId: string; bizName: string; bizNumber: string; phone: string; bankName: string; accountNumber: string; accountHolder: string; taxType: TaxType; hasBizCert: boolean; hasBankbook: boolean; }`
  - `export function listPayeesForExport(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeExportRow[]>` — Task 3(라우트)에서 이 시그니처를 그대로 사용.
  - `listPayees`의 기존 시그니처/동작은 변경 없음(리팩터링만).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payees.test.ts` 3~5행의 import를 다음으로 교체:

```ts
import {
  createPayeesBulk, listPayees, listPayeesForExport, findPayeeByBizNumber, parsePayeeSearchField,
  type PayeeCreateInput,
} from "@/lib/data/payees";
```

파일 마지막 `it(...)` 블록(141~145행) 다음, `});`(describe 종료) 앞에 추가:

```ts

  it("listPayeesForExport는 사업자번호 원문을 포함해 반환한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Acme")]);
    const [row] = await listPayeesForExport(ADMIN);
    expect(row.bizNumber).toBe("1234567890");
    expect(row.accountNumber).toBe("110123456789");
    expect(row.keyId).toBe("b001");
    expect(row.bizName).toBe("Acme");
  });

  it("listPayeesForExport도 listPayees와 동일한 검색 필터를 적용한다", async () => {
    await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR", "Acme"),
      input("9002022345678", "INSTRUCTOR", "다른이름"),
    ]);
    const hit = await listPayeesForExport(ADMIN, { field: "bizName", q: "acme" });
    expect(hit).toHaveLength(1);
    expect(hit[0].bizName).toBe("Acme");
  });

  it("listPayeesForExport는 SETTLEMENT/ADMIN 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    await expect(
      listPayeesForExport({ userId: "pm1", role: "PM" }),
    ).rejects.toThrow("지급 리스트 원문 조회 권한이 없습니다.");
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: 새로 추가한 3개 테스트가 FAIL (`listPayeesForExport`가 존재하지 않아 타입/런타임 에러)

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payees.ts` 33~46행(`PayeeRow` 타입) 바로 다음(48행 `const SEQ` 이전)에 추가:

```ts

// 엑셀 다운로드 전용(ADMIN·SETTLEMENT 전용) — 사업자번호 원문을 포함한다.
// 이 화면에 도달 가능한 역할이 이미 ADMIN/SETTLEMENT뿐이므로 별도 역할 분기 없이
// listPayees와 동일한 role 체크(fetchMatchedPayees 내부)에 얹는다.
export type PayeeExportRow = {
  keyId: string;
  bizName: string;
  bizNumber: string; // 복호화 원문
  phone: string;
  bankName: string;
  accountNumber: string; // 복호화 원문
  accountHolder: string;
  taxType: TaxType;
  hasBizCert: boolean;
  hasBankbook: boolean;
};
```

기존 `listPayees` 함수(121~156행) 전체를 다음으로 교체:

```ts
type MatchedPayee = Prisma.PayeeGetPayload<{
  include: { attachments: { select: { fileType: true } } };
}>;

// listPayees/listPayeesForExport 공통: role 체크 + 조회 + 인메모리 검색 필터링.
function fetchMatchedPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<MatchedPayee[]> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  return withRLS(ctx, async (tx) => {
    const rows = await tx.payee.findMany({
      orderBy: { keyId: "asc" },
      include: { attachments: { select: { fileType: true } } },
    });
    const q = filter?.q.trim();
    if (!filter || !q) return rows;
    return rows.filter((r) => {
      if (filter.field === "bizName") return r.bizName.toLowerCase().includes(q.toLowerCase());
      if (filter.field === "keyId") return r.keyId.toLowerCase().includes(q.toLowerCase());
      // 검색어가 URL 쿼리스트링에 그대로 남으므로(GET 폼), 원문 전체 노출 위험을 줄이기 위해
      // 사업자번호 검색은 앞 6자리까지만 사용한다.
      const qDigits = digitsOnly(q).slice(0, 6);
      return digitsOnly(decrypt(r.bizNumberEnc)).includes(qDigits);
    });
  });
}

export async function listPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeRow[]> {
  const rows = await fetchMatchedPayees(ctx, filter);
  return rows.map((r) => ({
    id: r.id,
    keyId: r.keyId,
    payeeType: r.payeeType,
    bizName: r.bizName,
    bizNumberMasked: r.bizNumberMasked,
    phone: r.phone,
    bankName: r.bankName,
    accountNumber: decrypt(r.accountNumberEnc),
    accountHolder: r.accountHolder,
    taxType: r.taxType,
    hasBizCert: r.attachments.some((a) => a.fileType === "BIZ_CERT"),
    hasBankbook: r.attachments.some((a) => a.fileType === "BANKBOOK"),
  }));
}

export async function listPayeesForExport(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeExportRow[]> {
  const rows = await fetchMatchedPayees(ctx, filter);
  return rows.map((r) => ({
    keyId: r.keyId,
    bizName: r.bizName,
    bizNumber: decrypt(r.bizNumberEnc),
    phone: r.phone,
    bankName: r.bankName,
    accountNumber: decrypt(r.accountNumberEnc),
    accountHolder: r.accountHolder,
    taxType: r.taxType,
    hasBizCert: r.attachments.some((a) => a.fileType === "BIZ_CERT"),
    hasBankbook: r.attachments.some((a) => a.fileType === "BANKBOOK"),
  }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: 전체 PASS (기존 케이스 포함, 회귀 없음)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payees): 엑셀 다운로드용 listPayeesForExport 추가"
```

---

### Task 2: 엑셀 생성 — `buildExportXlsxBuffer` (`xlsx.ts`)

**Files:**
- Modify: `src/app/(app)/expenses/payees/xlsx.ts` (파일 끝, 137행 이후에 추가 + 2행 import 수정)
- Test: `test/payee-xlsx.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PayeeExportRow`(from `@/lib/data/payees`); 기존 `displayWidth` 헬퍼(파일 내 12~19행, 이미 모듈 내부에 있음); `@/lib/labels`의 `taxTypeLabel`
- Produces:
  - `export const EXPORT_HEADERS = ["고유번호", "사업자명(이름)", "사업자번호", "연락처", "은행명", "계좌번호", "예금주", "청구방식", "사업자등록증 첨부", "통장사본 첨부"] as const;`
  - `export function buildExportXlsxBuffer(rows: PayeeExportRow[]): Promise<Buffer>` — Task 3(라우트)에서 이 시그니처를 그대로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payee-xlsx.test.ts` 2행의 import를 다음으로 교체:

```ts
import { parseXlsxToRows, buildTemplateXlsxBuffer, buildExportXlsxBuffer, TEMPLATE_HEADERS, EXPORT_HEADERS } from "@/app/(app)/expenses/payees/xlsx";
import type { PayeeExportRow } from "@/lib/data/payees";
```

파일 마지막(35행, `});` 앞) 기존 `describe` 블록 밖에 새 `describe` 블록 추가:

```ts

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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run test/payee-xlsx.test.ts`
Expected: 새로 추가한 2개 테스트가 FAIL (`buildExportXlsxBuffer`/`EXPORT_HEADERS`가 존재하지 않음)

- [ ] **Step 3: 최소 구현 작성**

`xlsx.ts` 2행을 다음으로 교체:

```ts
import ExcelJS from "exceljs";
import { TAX_TYPE_LABELS, taxTypeLabel } from "@/lib/labels";
import type { PayeeExportRow } from "@/lib/data/payees";
```

파일 끝(137행 `}` 다음)에 추가:

```ts

// 검색/필터 적용된 지급 리스트 다운로드용 컬럼 순서. 화면 테이블 헤더와 동일한 순서로 맞춘다.
export const EXPORT_HEADERS = [
  "고유번호", "사업자명(이름)", "사업자번호", "연락처", "은행명",
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
  const TEXT_COLUMNS = ["사업자번호", "계좌번호"] as const;
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/payee-xlsx.test.ts`
Expected: 전체 PASS (기존 서식 테스트 포함, 회귀 없음)

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/payees/xlsx.ts" test/payee-xlsx.test.ts
git commit -m "feat(payees): 지급리스트 엑셀 다운로드 워크북 생성 함수 추가"
```

---

### Task 3: API 라우트 (`payees/export/route.ts`)

**Files:**
- Create: `src/app/(app)/expenses/payees/export/route.ts`

**Interfaces:**
- Consumes: `requireRole`(from `@/lib/auth/session`), `getRlsContext`(from `@/lib/context`), Task 1의 `listPayeesForExport`/`parsePayeeSearchField`(from `@/lib/data/payees`), Task 2의 `buildExportXlsxBuffer`(from `../xlsx`)
- Produces: GET `/expenses/payees/export?field=&q=` — xlsx 파일 다운로드 응답. Task 4(UI)가 이 URL을 링크로 사용.

이 라우트는 기존 `template/route.ts`, `attachment-download/route.ts`와 동일하게 프로젝트에 route handler용 테스트 인프라가 없어(기존 두 라우트도 테스트 없음) 타입 체크 + 수동 검증으로 확인한다.

- [ ] **Step 1: 라우트 파일 작성**

`src/app/(app)/expenses/payees/export/route.ts` 신규 생성:

```ts
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listPayeesForExport, parsePayeeSearchField } from "@/lib/data/payees";
import { buildExportXlsxBuffer } from "../xlsx";

export const runtime = "nodejs";

// 지급 리스트 엑셀 다운로드(현재 검색/필터 결과 그대로). ADMIN·SETTLEMENT 전용,
// 사업자번호는 마스킹이 아닌 원문으로 포함한다.
export async function GET(req: NextRequest) {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);

  const field = parsePayeeSearchField(req.nextUrl.searchParams.get("field") ?? undefined);
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const filter = field && q.trim() ? { field, q } : undefined;

  const rows = await listPayeesForExport(ctx, filter);
  const buf = await buildExportXlsxBuffer(rows);

  const kstDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).replaceAll("-", "");
  const filename = encodeURIComponent(`지급리스트_${kstDate}.xlsx`);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/expenses/payees/export/route.ts"
git commit -m "feat(payees): 지급리스트 엑셀 다운로드 라우트 추가"
```

---

### Task 4: UI 연결 (`PayeeListPanel.tsx`)

**Files:**
- Modify: `src/app/(app)/expenses/PayeeListPanel.tsx:134-145`

**Interfaces:**
- Consumes: Task 3의 `/expenses/payees/export` 라우트; 컴포넌트가 이미 받고 있는 `field`(prop, `PayeeSearchField`), `q`(prop, string), `rows`(prop, `PayeeRow[]`)
- Produces: 없음(최종 UI)

- [ ] **Step 1: 다운로드 버튼을 링크/비활성 버튼으로 교체**

`PayeeListPanel.tsx` 134~145행:

```tsx
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            📗 엑셀 다운로드
          </button>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white"
          >
            + 등록
          </button>
        </div>
```

를 다음으로 교체:

```tsx
        <div className="flex items-center gap-2">
          {rows.length > 0 ? (
            <a
              href={`/expenses/payees/export?field=${field}&q=${encodeURIComponent(q)}`}
              className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
            >
              📗 엑셀 다운로드
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
          )}
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white"
          >
            + 등록
          </button>
        </div>
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 전체 테스트 재실행**

Run: `npx vitest run`
Expected: 전체 PASS (회귀 없음)

- [ ] **Step 4: 수동 검증 (개발 서버)**

```bash
npm run dev
```

브라우저에서 `/expenses?tab=payment-list` 접속 후:
1. 검색 없이 [📗 엑셀 다운로드] 클릭 → `지급리스트_YYYYMMDD.xlsx` 파일이 다운로드되고, 전체 목록이 화면과 동일한 순서로 담겨 있는지 확인
2. 열어서 "사업자번호" 컬럼이 마스킹이 아닌 원문(예: `123-45-67890` 형태의 숫자)으로 보이는지 확인, 선행 0이 있는 값도 잘리지 않는지 확인
3. "사업자등록증 첨부"/"통장사본 첨부" 컬럼이 화면의 📎/⚠ 뱃지와 일치하게 O/X로 표시되는지 확인
4. 검색어로 필터링한 뒤 다운로드 → 필터링된 결과만 포함되는지 확인
5. 검색 결과 0건 상태에서 다운로드 버튼이 비활성화(클릭 불가, 마우스오버 시 "다운로드할 데이터가 없습니다" 툴팁)되는지 확인
6. SETTLEMENT 계정과 ADMIN 계정 각각으로 다운로드가 정상 동작하는지 확인(다른 role 계정이 있다면 `/expenses/payees/export` 직접 접근 시 리다이렉트되는지도 확인)

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/PayeeListPanel.tsx"
git commit -m "feat(payees): 지급리스트 엑셀 다운로드 버튼 연결"
```

---

## Self-Review 결과

- **스펙 커버리지**: 현재 화면(검색/필터 적용) 다운로드(Task 3·4, field/q 쿼리 전달), 10개 컬럼 구성(Task 2, `EXPORT_HEADERS`), 사업자번호 원문 포함(Task 1, `PayeeExportRow.bizNumber`), 첨부파일 여부 컬럼 2개 분리(Task 2), GET 라우트 링크 방식(Task 3·4), 파일명 규칙(Task 3), 기존 서식 수준 스타일링(Task 2), 결과 0건 시 버튼 비활성화(Task 4), 권한(SETTLEMENT/ADMIN, Task 1·3) — 설계 문서의 모든 결정 사항이 태스크에 매핑됨.
- **플레이스홀더 스캔**: 없음 — 모든 스텝에 실제 코드 포함.
- **타입 일관성**: `PayeeExportRow`(Task 1 정의) → `xlsx.ts`의 `buildExportXlsxBuffer`(Task 2에서 동일 타입 소비) → `export/route.ts`(Task 3에서 `listPayeesForExport`/`buildExportXlsxBuffer` 시그니처 그대로 사용) → `PayeeListPanel.tsx`(Task 4는 새 타입을 직접 소비하지 않고 기존 `field`/`q` props만 사용) 간 이름·형태 일치 확인.
