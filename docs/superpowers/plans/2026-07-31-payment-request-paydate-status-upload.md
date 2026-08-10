# 지급요청 엑셀 재업로드(지급일/지급여부 반영) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `PaymentRequest`에 영구 고정 채번(`seqNo`)을 추가해 목록의 "No"와 엑셀의 "No"가 같은 안정적인 값을 쓰게 하고, 엑셀 다운로드에 지급일/지급여부 컬럼을 추가한 뒤, 그 파일을 수정해 재업로드하면 `No`로 매칭된 건의 지급일/지급여부만 DB에 부분 반영되는 기능을 완성한다.

**Architecture:** Postgres 시퀀스 기반 `seqNo` 컬럼을 추가하는 마이그레이션 → 데이터 계층에 `seqNo`/`payDate`/`status` 필드 노출 → 엑셀 빌더에 컬럼 추가 + 드롭다운 검증 → 업로드 파싱(순수 함수) → 데이터 계층 부분 업데이트 함수 → 서버 액션 → 기존 스텁 모달을 실제 제출로 교체. `payees` 폴더의 업로드(헤더 이름 매핑, `{row,message}` 오류 배열, 부분성공 UX)와 지급 리스트 등록 서식(드롭다운 유효성 검사)의 기존 패턴을 그대로 재사용한다.

**Tech Stack:** Next.js App Router(서버 액션), Prisma(PostgreSQL, RLS), exceljs, vitest.

## Global Constraints

- `seqNo`는 등록 시 한 번 채번되고 이후 절대 바뀌지 않는 정수(Payee.keyId와 같은 역할, 형식은 순수 정수). 기존 행은 `requestedAt` 오름차순으로 명시적으로 백필한다(Prisma 기본 임의 순서 금지).
- 이 저장소는 `npx prisma migrate dev`가 shadow DB 문제로 100% 깨진다 — 반드시 `prisma migrate diff --from-schema-datamodel <백업> --to-schema-datamodel prisma/schema.prisma --script`로 SQL을 뽑아 손질한 뒤 `npx prisma migrate deploy`로만 적용한다.
- 목록 화면 "No"와 엑셀 "No"는 모두 `seqNo`를 표시한다(위치 계산값 사용 금지).
- 엑셀 컬럼 순서(20열, 고정): 기존 18열(No로 이름만 바뀐 첫 컬럼 포함) 그대로 + `지급일`, `지급여부`(상세내역 뒤).
- `지급여부` 컬럼에는 드롭다운 데이터 유효성 검사("지급준비"/"지급완료") 적용. `지급일` 컬럼은 텍스트 서식(`numFmt:"@"`), 형식은 `YYYY-MM-DD`.
- 재업로드 시 "No"/"지급일"/"지급여부" 3개 컬럼만 이름으로 찾아 읽고 반영한다. 나머지 17개 컬럼 값은 무시한다.
- 검증 규칙: `지급여부`는 "지급준비"/"지급완료" 중 하나만 허용(그 외/공란은 오류). `지급일`은 그 행의 `지급여부`가 "지급완료"일 때만 필수(공란이면 오류). `지급여부`가 "지급준비"인 행은 `지급일` 공란을 허용하고, 값이 있으면 그대로 반영한다. `No`로 매칭되는 건을 찾지 못하면(삭제됨 포함) 오류.
- 반영은 부분 반영(all-or-nothing 아님) — 유효한 행만 DB에 반영, 오류 행은 반영하지 않고 "N행: 사유" 형태로 안내.
- 업로드는 `.xlsx`만 지원(CSV/XLS 지원 안 함).
- 권한: `requireRole("SETTLEMENT")`(ADMIN도 랭크상 통과) — 화면 버튼 노출 조건(`canExport`)은 이미 동일하게 걸려있어 변경 없음.
- 참고 스펙: `docs/superpowers/specs/2026-07-31-payment-request-paydate-status-upload-design.md`

---

### Task 1: `seqNo` 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260731070000_add_payment_request_seq_no/migration.sql`

**Interfaces:**
- Consumes: 없음(스키마/DB 레벨 변경).
- Produces: `PaymentRequest.seqNo`(Prisma Client가 `Int`로 인식, `@unique`) — Task 2가 이 필드를 조회/매핑에 사용한다.

이 태스크는 자동화 테스트가 없다(마이그레이션 자체는 저장소에 단위테스트 관례가 없음). `npx vitest run` 시 `test/global-setup.ts`가 테스트 DB에 `prisma migrate deploy`를 자동 실행하므로, 이 마이그레이션 파일이 존재하면 이후 태스크의 테스트 실행 시 자동 적용된다.

- [ ] **Step 1: 변경 전 스키마 백업**

```bash
cp prisma/schema.prisma prisma/schema.prisma.bak
```

- [ ] **Step 2: `schema.prisma`에 `seqNo` 필드 추가**

`prisma/schema.prisma`의 `model PaymentRequest {` 블록에서 `id` 필드 다음 줄에 추가:

```prisma
model PaymentRequest {
  id            String                @id @default(cuid())
  seqNo         Int                   @unique @default(autoincrement()) // 영구 고정 채번(No) — Payee.keyId처럼 등록 시 한 번 정해지고 이후 바뀌지 않음
  requestedAt   DateTime              @default(now())   // 신청일 (자동)
```

(그 아래 기존 필드들은 그대로 둔다.)

- [ ] **Step 3: 마이그레이션 SQL 초안 생성**

```bash
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma.bak --to-schema-datamodel prisma/schema.prisma --script
```

출력된 SQL(대략 `ALTER TABLE "PaymentRequest" ADD COLUMN "seqNo" INTEGER NOT NULL DEFAULT nextval(...)` 형태)은 기존 행에 임의 순서로 채번하므로 그대로 쓰지 않는다 — 다음 단계에서 백필 로직으로 손질한 버전을 저장한다.

- [ ] **Step 4: 마이그레이션 파일 작성**

디렉토리 생성 후 `prisma/migrations/20260731070000_add_payment_request_seq_no/migration.sql`을 아래 내용으로 작성(초안 SQL을 참고하되 이 내용으로 완전히 대체):

```sql
-- CreateSequence
CREATE SEQUENCE "PaymentRequest_seqNo_seq";

-- AddColumn (nullable 상태로 우선 추가)
ALTER TABLE "PaymentRequest" ADD COLUMN "seqNo" INTEGER;

-- Backfill: 기존 행은 requestedAt 오름차순으로 명시적으로 채번 (Prisma 기본 임의 순서 대신)
UPDATE "PaymentRequest" pr
SET "seqNo" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "requestedAt", id) AS rn
  FROM "PaymentRequest"
) sub
WHERE pr.id = sub.id;

-- 시퀀스가 백필된 최댓값 다음부터 이어지도록 설정
SELECT setval('"PaymentRequest_seqNo_seq"', COALESCE((SELECT MAX("seqNo") FROM "PaymentRequest"), 0) + 1, false);

-- NOT NULL + 시퀀스 기본값 확정
ALTER TABLE "PaymentRequest" ALTER COLUMN "seqNo" SET NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "seqNo" SET DEFAULT nextval('"PaymentRequest_seqNo_seq"');
ALTER SEQUENCE "PaymentRequest_seqNo_seq" OWNED BY "PaymentRequest"."seqNo";

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_seqNo_key" ON "PaymentRequest"("seqNo");
```

- [ ] **Step 5: 마이그레이션 적용 및 확인**

```bash
npx prisma migrate deploy
npx prisma migrate status
```

`npx prisma migrate status`가 "Database schema is up to date!"를 출력하는지 확인. **`npx prisma migrate dev`는 절대 실행하지 말 것** — shadow DB 문제로 100% 실패한다.

`PaymentRequest`는 `FORCE ROW LEVEL SECURITY`가 걸려있다. 만약 `ALTER TABLE "PaymentRequest" ALTER COLUMN "seqNo" SET NOT NULL;` 단계에서 "column contains null values" 오류가 나면, 이는 백필 UPDATE가 RLS 정책에 막혀 0건 반영된 것이다(마이그레이션 연결 role에 BYPASSRLS/슈퍼유저 권한이 없는 경우) — 재시도로 해결되지 않으니, 그 경우 즉시 작업을 멈추고 보고할 것(추측으로 RLS를 비활성화하거나 우회하지 말 것).

- [ ] **Step 6: Prisma Client 타입 갱신**

```bash
npx prisma generate
```

- [ ] **Step 7: 백업 파일 정리**

```bash
rm prisma/schema.prisma.bak
```

- [ ] **Step 8: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations/20260731070000_add_payment_request_seq_no
git commit -m "feat(payment-request): PaymentRequest에 영구 고정 채번(seqNo) 컬럼 추가"
```

---

### Task 2: 데이터 계층 — `seqNo`/`payDate`/`status` 노출

**Files:**
- Modify: `src/lib/data/payment-requests.ts`
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PaymentRequest.seqNo`(Prisma Client 필드).
- Produces: `PaymentRequestRow`에 `seqNo: number` 추가, `PaymentRequestExportRow`에 `seqNo: number`/`payDate: Date | null`/`status: PaymentRequestStatus` 추가. Task 3(목록 화면)과 Task 4(엑셀 빌더)가 이 필드들을 그대로 소비한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-requests.test.ts`에서 `listPaymentRequests`를 다루는 기존 테스트들 중 아무 곳에나(예: "신청인 이름과 고객사명을 조인해서 반환한다" 테스트 바로 뒤) 아래 테스트를 추가:

```ts
  it("seqNo는 자동으로, 유일하게 채번된다", async () => {
    const { pmA, clientA } = await seed();
    const r1 = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
      data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건" }),
    }));
    const r2 = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
      data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건" }),
    }));
    expect(r1.seqNo).toBeGreaterThan(0);
    expect(r2.seqNo).toBeGreaterThan(r1.seqNo);

    const { rows } = await listPaymentRequests(ADMIN);
    const bySeqNo = new Map(rows.map((r) => [r.bizName, r.seqNo]));
    expect(bySeqNo.get("A건")).toBe(r1.seqNo);
    expect(bySeqNo.get("B건")).toBe(r2.seqNo);
  });
```

`describe("listPaymentRequestsForExport", ...)` 블록 안(마지막 `it` 뒤)에 아래 테스트도 추가:

```ts
    it("seqNo/지급일/지급여부를 포함한다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({
          requesterId: pmA.id, clientId: clientA.id, bizName: "C건",
          payDate: new Date("2026-08-05"), status: "COMPLETED",
        }),
      }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.seqNo).toBe(created.seqNo);
      expect(row.payDate).toEqual(new Date("2026-08-05"));
      expect(row.status).toBe("COMPLETED");
    });
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: FAIL — `Property 'seqNo' does not exist` 또는 `expect(received).toBe(undefined)` 형태.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payment-requests.ts`의 `PaymentRequestRow` 타입에 `seqNo: number` 추가:

```ts
export type PaymentRequestRow = {
  id: string;
  seqNo: number;
  requestedAt: Date;
  requesterId: string;
  requesterName: string;
  entity: PaymentRequestEntity;
  clientId: string;
  clientName: string;
  bizName: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  amount: number;
  taxType: TaxType;
  memo: string;
  payDate: Date | null;
  status: PaymentRequestStatus;
};
```

`listPaymentRequests`의 매핑(`const mapped = rows.map((r) => ({ ... }))`)에 `seqNo: r.seqNo,`를 `id: r.id,` 다음 줄에 추가.

`PaymentRequestExportRow` 타입에 3개 필드 추가:

```ts
export type PaymentRequestExportRow = {
  seqNo: number;
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
  payDate: Date | null;
  status: PaymentRequestStatus;
};
```

`listPaymentRequestsForExport`의 반환 매핑에 필드 추가:

```ts
  return rows.map((r) => ({
    seqNo: r.seqNo,
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
    payDate: r.payDate,
    status: r.status,
  }));
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: PASS(전체, 기존 케이스 포함).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat(payment-request): PaymentRequestRow/ExportRow에 seqNo·지급일·지급여부 노출"
```

---

### Task 3: 목록 화면 "No" → `seqNo`

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestListPanel.tsx`

**Interfaces:**
- Consumes: Task 2의 `PaymentRequestRow.seqNo`.
- Produces: 없음(화면 변경).

이 태스크는 UI 전용 한 줄 변경이라 자동화 테스트가 없다. 타입 체크 + 전체 테스트로 회귀만 확인한다.

- [ ] **Step 1: import 정리**

`src/app/(app)/expenses/PaymentRequestListPanel.tsx:6`을 아래로 교체(더 이상 위치 계산에 페이지 크기가 필요 없음):

```tsx
import type { PaymentRequestRow } from "@/lib/data/payment-requests";
```

- [ ] **Step 2: "No" 컬럼 값 교체**

`src/app/(app)/expenses/PaymentRequestListPanel.tsx:190`의 `{rows.map((r, i) => (`를 `{rows.map((r) => (`로 바꾸고(더 이상 인덱스가 필요 없음), 195행을 아래로 교체:

```tsx
                <td className="whitespace-nowrap px-3 py-2">{r.seqNo}</td>
```

- [ ] **Step 3: 타입 체크 + 전체 테스트**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 에러 없음(미사용 import/변수 없음 확인).

Run: `npx vitest run`
Expected: 전체 PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/app/"(app)"/expenses/PaymentRequestListPanel.tsx
git commit -m "feat(payment-request): 목록 화면 No 컬럼을 위치값 대신 seqNo로 표시"
```

---

### Task 4: 엑셀 빌더 — "No" + 지급일/지급여부 컬럼

**Files:**
- Modify: `src/app/(app)/expenses/payment-request/xlsx.ts`
- Modify: `test/payment-request-xlsx.test.ts`

**Interfaces:**
- Consumes: Task 2의 `PaymentRequestExportRow.seqNo`/`payDate`/`status`, `@/lib/labels`의 `PAYMENT_REQUEST_STATUS_LABELS`/`paymentRequestStatusLabel`(기존, 변경 없음).
- Produces: `EXPORT_HEADERS`가 20열(첫 컬럼 "No", 끝에 "지급일"/"지급여부" 추가)로 바뀜. Task 6(서버 액션 경유 업로드 파싱)이 같은 헤더 이름("No"/"지급일"/"지급여부")을 기대하므로 헤더 문자열을 정확히 맞춘다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payment-request-xlsx.test.ts` 전체를 아래 내용으로 교체(기존 4개 테스트를 새 20열 스키마에 맞게 고치고, 신규 테스트 2개 추가):

```ts
import { describe, it, expect } from "vitest";
import { parseXlsxToRows } from "@/app/(app)/expenses/payees/xlsx";
import { buildPaymentRequestExportXlsxBuffer, EXPORT_HEADERS } from "@/app/(app)/expenses/payment-request/xlsx";
import type { PaymentRequestExportRow } from "@/lib/data/payment-requests";

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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run test/payment-request-xlsx.test.ts`
Expected: FAIL — 타입 에러(`PaymentRequestExportRow`에 `seqNo`/`payDate`/`status` 없음 — Task 2가 먼저 끝나 있어야 함, 이미 끝난 상태이므로 컴파일은 되고) 및 `EXPORT_HEADERS` 길이/내용 불일치로 실패.

- [ ] **Step 3: 최소 구현 작성**

`src/app/(app)/expenses/payment-request/xlsx.ts` 전체를 아래 내용으로 교체:

```ts
import ExcelJS from "exceljs";
import { paymentRequestEntityLabel, taxTypeLabel, paymentRequestStatusLabel, PAYMENT_REQUEST_STATUS_LABELS } from "@/lib/labels";
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
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run test/payment-request-xlsx.test.ts`
Expected: PASS(6개 테스트 모두).

- [ ] **Step 5: 커밋**

```bash
git add src/app/"(app)"/expenses/payment-request/xlsx.ts test/payment-request-xlsx.test.ts
git commit -m "feat(payment-request): 엑셀에 No(seqNo)·지급일·지급여부 컬럼 추가, 지급여부 드롭다운 검증"
```

---

### Task 5: 업로드 파싱 — `buildPaymentRequestUpdatesFromRows`

**Files:**
- Create: `src/lib/data/payment-request-upload.ts`
- Test: `test/payment-request-upload.test.ts`

**Interfaces:**
- Consumes: 없음(순수 함수, `string[][]` 입력 — `payees/xlsx.ts`의 `parseXlsxToRows` 출력과 동일한 모양).
- Produces:
  ```ts
  export type PaymentRequestUpdateInput = {
    row: number;
    seqNo: number;
    payDate: Date | null;
    status: PaymentRequestStatus;
  };
  export type PaymentRequestUpdateBuildResult = {
    updates: PaymentRequestUpdateInput[];
    errors: { row: number; message: string }[];
  };
  export function buildPaymentRequestUpdatesFromRows(rows: string[][]): PaymentRequestUpdateBuildResult
  ```
  Task 6(데이터 계층)의 `updatePaymentRequestsBulk`와 Task 7(서버 액션)이 이 타입/함수를 그대로 소비한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payment-request-upload.test.ts` 신규 생성:

```ts
import { describe, it, expect } from "vitest";
import { buildPaymentRequestUpdatesFromRows } from "@/lib/data/payment-request-upload";

const HEADER = ["No", "지급일", "지급여부"];

describe("buildPaymentRequestUpdatesFromRows", () => {
  it("정상 행을 파싱한다", () => {
    const result = buildPaymentRequestUpdatesFromRows([
      HEADER,
      ["1", "2026-08-05", "지급완료"],
      ["2", "", "지급준비"],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.updates).toEqual([
      { row: 2, seqNo: 1, payDate: new Date("2026-08-05T00:00:00.000Z"), status: "COMPLETED" },
      { row: 3, seqNo: 2, payDate: null, status: "PREPARING" },
    ]);
  });

  it("No가 정수가 아니면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["abc", "2026-08-05", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: "No 값이 올바르지 않습니다." }]);
  });

  it("No가 공란이면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["", "2026-08-05", "지급완료"]]);
    expect(result.errors).toEqual([{ row: 2, message: "No 값이 올바르지 않습니다." }]);
  });

  it("지급여부가 지급준비/지급완료가 아니면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2026-08-05", "완료함"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급여부");
  });

  it("지급완료인데 지급일이 공란이면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors).toEqual([{ row: 2, message: "지급완료 처리하려면 지급일을 입력해야 합니다." }]);
  });

  it("지급준비인데 지급일이 공란이면 정상 처리(공란 허용)", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "", "지급준비"]]);
    expect(result.errors).toEqual([]);
    expect(result.updates).toEqual([{ row: 2, seqNo: 1, payDate: null, status: "PREPARING" }]);
  });

  it("지급일 형식이 YYYY-MM-DD가 아니면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["1", "2026/08/05", "지급완료"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors[0].message).toContain("지급일 형식");
  });

  it("완전히 빈 행은 건너뛴다", () => {
    const result = buildPaymentRequestUpdatesFromRows([HEADER, ["", "", ""], ["1", "", "지급준비"]]);
    expect(result.updates).toEqual([{ row: 3, seqNo: 1, payDate: null, status: "PREPARING" }]);
    expect(result.errors).toEqual([]);
  });

  it("헤더 누락 시 전체 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([["No", "지급여부"], ["1", "지급준비"]]);
    expect(result.updates).toEqual([]);
    expect(result.errors).toEqual([{ row: 0, message: "헤더 누락: 지급일" }]);
  });

  it("빈 파일이면 오류", () => {
    const result = buildPaymentRequestUpdatesFromRows([]);
    expect(result.errors).toEqual([{ row: 0, message: "빈 파일입니다." }]);
  });

  it("여러 행 중 일부만 오류여도 나머지는 정상 반환된다", () => {
    const result = buildPaymentRequestUpdatesFromRows([
      HEADER,
      ["1", "2026-08-05", "지급완료"],
      ["abc", "2026-08-05", "지급완료"],
      ["2", "", "지급준비"],
    ]);
    expect(result.updates).toHaveLength(2);
    expect(result.errors).toEqual([{ row: 3, message: "No 값이 올바르지 않습니다." }]);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run test/payment-request-upload.test.ts`
Expected: FAIL — `Cannot find module '@/lib/data/payment-request-upload'`.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payment-request-upload.ts` 신규 생성:

```ts
import type { PaymentRequestStatus } from "@prisma/client";

export type PaymentRequestUpdateInput = {
  row: number;
  seqNo: number;
  payDate: Date | null;
  status: PaymentRequestStatus;
};

export type PaymentRequestUpdateBuildResult = {
  updates: PaymentRequestUpdateInput[];
  errors: { row: number; message: string }[];
};

const HEADERS = ["No", "지급일", "지급여부"] as const;

const STATUS_BY_LABEL: Record<string, PaymentRequestStatus> = {
  "지급준비": "PREPARING",
  "지급완료": "COMPLETED",
};

// <input type="date">와 동일하게 "YYYY-MM-DD"만 허용.
function parseDateCell(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// 엑셀 재업로드 파싱 — 헤더에서 "No"/"지급일"/"지급여부" 3개만 이름으로 찾아 읽는다(나머지 컬럼은
// 반영 대상이 아니므로 무시). No로 매칭될 대상 존재 여부는 여기서 확인하지 않는다(DB 조회가
// 필요해 데이터 계층의 몫 — updatePaymentRequestsBulk가 담당).
export function buildPaymentRequestUpdatesFromRows(rows: string[][]): PaymentRequestUpdateBuildResult {
  const updates: PaymentRequestUpdateInput[] = [];
  const errors: PaymentRequestUpdateBuildResult["errors"] = [];

  if (rows.length === 0) return { updates, errors: [{ row: 0, message: "빈 파일입니다." }] };

  const header = rows[0].map((h) => h.trim());
  const colIndex: Record<string, number> = {};
  const missing: string[] = [];
  for (const field of HEADERS) {
    const idx = header.indexOf(field);
    if (idx === -1) missing.push(field);
    else colIndex[field] = idx;
  }
  if (missing.length > 0) {
    return { updates, errors: [{ row: 0, message: `헤더 누락: ${missing.join(", ")}` }] };
  }
  const at = (cells: string[], field: string) => (cells[colIndex[field]] ?? "").trim();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => (c ?? "").trim() === "")) continue; // 빈 행 skip
    const rowNum = r + 1;

    const noCell = at(cells, "No");
    const seqNo = Number(noCell);
    if (!noCell || !Number.isInteger(seqNo) || seqNo <= 0) {
      errors.push({ row: rowNum, message: "No 값이 올바르지 않습니다." });
      continue;
    }

    const statusLabel = at(cells, "지급여부");
    const status = STATUS_BY_LABEL[statusLabel];
    if (!status) {
      errors.push({ row: rowNum, message: "지급여부 값이 올바르지 않습니다(지급준비/지급완료 중 하나여야 함)." });
      continue;
    }

    const payDateCell = at(cells, "지급일");
    let payDate: Date | null = null;
    if (payDateCell) {
      const parsed = parseDateCell(payDateCell);
      if (!parsed) {
        errors.push({ row: rowNum, message: "지급일 형식이 올바르지 않습니다(YYYY-MM-DD)." });
        continue;
      }
      payDate = parsed;
    } else if (status === "COMPLETED") {
      errors.push({ row: rowNum, message: "지급완료 처리하려면 지급일을 입력해야 합니다." });
      continue;
    }

    updates.push({ row: rowNum, seqNo, payDate, status });
  }

  return { updates, errors };
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run test/payment-request-upload.test.ts`
Expected: PASS(11개 테스트 모두).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payment-request-upload.ts test/payment-request-upload.test.ts
git commit -m "feat(payment-request): 엑셀 재업로드 파싱 buildPaymentRequestUpdatesFromRows 추가"
```

---

### Task 6: 데이터 계층 — `updatePaymentRequestsBulk`

**Files:**
- Modify: `src/lib/data/payment-requests.ts`
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: 없음 직접 의존은 없음(입력 타입은 `{seqNo, payDate, status}[]` — Task 5의 `PaymentRequestUpdateInput[]`을 그대로 넘겨도 구조적으로 호환).
- Produces:
  ```ts
  export type PaymentRequestBulkUpdateResult = { updated: number; notFoundSeqNos: number[] };
  export function updatePaymentRequestsBulk(
    ctx: RlsContext,
    updates: { seqNo: number; payDate: Date | null; status: PaymentRequestStatus }[],
  ): Promise<PaymentRequestBulkUpdateResult>
  ```
  Task 7(서버 액션)이 이 함수를 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-requests.test.ts`의 import에 `updatePaymentRequestsBulk` 추가:

```ts
import {
  listPaymentRequests, parsePaymentRequestPage, parsePaymentRequestEntity,
  parsePaymentRequestStatus, parsePaymentRequestDateParam, PAYMENT_REQUEST_PAGE_SIZE,
  createPaymentRequestsBulk, listPaymentRequestsForExport, updatePaymentRequestsBulk,
} from "@/lib/data/payment-requests";
```

파일 맨 끝(최상위 `describe("payment-requests 데이터 계층", ...)` 블록의 닫는 `});` 바로 앞, 즉 `describe("listPaymentRequestsForExport", ...)` 블록이 끝난 뒤)에 추가:

```ts
  describe("updatePaymentRequestsBulk", () => {
    it("seqNo로 매칭된 건의 지급일/지급여부만 갱신한다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건", unitPrice: 50000 }),
      }));

      const result = await updatePaymentRequestsBulk(ADMIN, [
        { seqNo: created.seqNo, payDate: new Date("2026-08-05"), status: "COMPLETED" },
      ]);
      expect(result).toEqual({ updated: 1, notFoundSeqNos: [] });

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.payDate).toEqual(new Date("2026-08-05"));
      expect(row.status).toBe("COMPLETED");
      expect(row.unitPrice).toBe(50000); // 다른 필드는 그대로
    });

    it("존재하지 않는 seqNo는 notFoundSeqNos로 보고한다", async () => {
      const result = await updatePaymentRequestsBulk(ADMIN, [
        { seqNo: 999999, payDate: new Date("2026-08-05"), status: "COMPLETED" },
      ]);
      expect(result).toEqual({ updated: 0, notFoundSeqNos: [999999] });
    });

    it("소프트 삭제된 건은 매칭 대상에서 제외한다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "삭제건" }),
      }));
      await withRLS(ADMIN, (tx) => tx.paymentRequest.update({ where: { id: created.id }, data: { deletedAt: new Date() } }));

      const result = await updatePaymentRequestsBulk(ADMIN, [
        { seqNo: created.seqNo, payDate: new Date("2026-08-05"), status: "COMPLETED" },
      ]);
      expect(result).toEqual({ updated: 0, notFoundSeqNos: [created.seqNo] });
    });

    it("지급일을 null로 업로드하면 기존 값을 지운다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건", payDate: new Date("2026-08-01"), status: "COMPLETED" }),
      }));

      await updatePaymentRequestsBulk(ADMIN, [{ seqNo: created.seqNo, payDate: null, status: "PREPARING" }]);

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.payDate).toBeNull();
      expect(row.status).toBe("PREPARING");
    });

    it("여러 건을 한 번에 반영한다", async () => {
      const { pmA, clientA } = await seed();
      const a = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건" }),
      }));
      const b = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건" }),
      }));

      const result = await updatePaymentRequestsBulk(ADMIN, [
        { seqNo: a.seqNo, payDate: new Date("2026-08-05"), status: "COMPLETED" },
        { seqNo: b.seqNo, payDate: null, status: "PREPARING" },
      ]);
      expect(result).toEqual({ updated: 2, notFoundSeqNos: [] });
    });
  });
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: FAIL — `updatePaymentRequestsBulk is not a function`.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payment-requests.ts`의 `createPaymentRequestsBulk` 함수 뒤(파일 끝)에 추가:

```ts
export type PaymentRequestBulkUpdateResult = { updated: number; notFoundSeqNos: number[] };

// 엑셀 재업로드 반영 전용. seqNo로 대상을 찾아 payDate/status만 갱신한다(다른 필드는 건드리지
// 않음). 존재하지 않거나 소프트 삭제된 seqNo는 notFoundSeqNos로 보고 — 호출부(서버 액션)가
// 업로드 파일의 원래 행 번호로 역매핑해 사용자에게 안내한다.
export async function updatePaymentRequestsBulk(
  ctx: RlsContext,
  updates: { seqNo: number; payDate: Date | null; status: PaymentRequestStatus }[],
): Promise<PaymentRequestBulkUpdateResult> {
  return withRLS(ctx, async (tx) => {
    const seqNos = updates.map((u) => u.seqNo);
    const found = await tx.paymentRequest.findMany({
      where: { seqNo: { in: seqNos }, deletedAt: null },
      select: { id: true, seqNo: true },
    });
    const idBySeqNo = new Map(found.map((f) => [f.seqNo, f.id]));

    let updated = 0;
    const notFoundSeqNos: number[] = [];
    for (const u of updates) {
      const id = idBySeqNo.get(u.seqNo);
      if (!id) { notFoundSeqNos.push(u.seqNo); continue; }
      await tx.paymentRequest.update({ where: { id }, data: { payDate: u.payDate, status: u.status } });
      updated++;
    }
    return { updated, notFoundSeqNos };
  });
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: PASS(전체, 기존 케이스 포함).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat(payment-request): seqNo 매칭 부분 업데이트 updatePaymentRequestsBulk 추가"
```

---

### Task 7: 서버 액션 — `uploadPaymentRequestUpdatesAction`

**Files:**
- Create: `src/app/(app)/expenses/payment-request/upload-state.ts`
- Create: `src/app/(app)/expenses/payment-request/actions.ts`

**Interfaces:**
- Consumes: Task 5의 `buildPaymentRequestUpdatesFromRows`, Task 6의 `updatePaymentRequestsBulk`, 기존 `parseXlsxToRows`(`@/app/(app)/expenses/payees/xlsx`), 기존 `requireRole`/`getRlsContext`.
- Produces: `uploadPaymentRequestUpdatesAction(prev, formData): Promise<PaymentRequestUploadState>`, `PaymentRequestUploadState` 타입. Task 8(모달)이 이 둘을 그대로 소비한다.

이 저장소는 서버 액션(얇은 `requireRole` + 데이터 계층 호출 wrapper) 자체에 대한 단위테스트 관례가 없다(`payees/actions.ts`의 `uploadPayeesAction`도 테스트 없음 — 실제 로직은 이미 테스트된 순수 함수/데이터 계층에 있음). 타입 체크로 검증한다.

- [ ] **Step 1: `upload-state.ts` 작성**

`src/app/(app)/expenses/payment-request/upload-state.ts` 신규 생성:

```ts
import type { ActionState } from "@/lib/action-state";

// 업로드 결과 상태(모달의 useActionState용). "use server" 파일(actions.ts)은 함수만 export할 수
// 있어 상수/타입은 여기 일반 모듈에 둔다.
export type PaymentRequestUploadState = ActionState & {
  updated?: number;
  rowErrors?: { row: number; message: string }[];
};

export const PAYMENT_REQUEST_UPLOAD_INIT: PaymentRequestUploadState = { ok: true };
```

- [ ] **Step 2: `actions.ts` 작성**

`src/app/(app)/expenses/payment-request/actions.ts` 신규 생성:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { updatePaymentRequestsBulk } from "@/lib/data/payment-requests";
import { buildPaymentRequestUpdatesFromRows } from "@/lib/data/payment-request-upload";
import { parseXlsxToRows } from "../payees/xlsx";
import type { PaymentRequestUploadState } from "./upload-state";

export async function uploadPaymentRequestUpdatesAction(
  _prev: PaymentRequestUploadState,
  formData: FormData,
): Promise<PaymentRequestUploadState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택하세요." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "지원하지 않는 형식입니다 (.xlsx만 가능)." };
  }

  let rows: string[][];
  try {
    rows = await parseXlsxToRows(await file.arrayBuffer());
  } catch (e) {
    console.error("[payment-request upload] 파일 읽기 실패:", e);
    return { ok: false, error: "파일을 읽을 수 없습니다. 양식을 확인하세요." };
  }

  const { updates, errors } = buildPaymentRequestUpdatesFromRows(rows);
  if (updates.length === 0) {
    return {
      ok: false,
      error: errors.length ? "반영할 유효한 행이 없습니다." : "반영할 데이터가 없습니다.",
      rowErrors: errors,
    };
  }

  let result: { updated: number; notFoundSeqNos: number[] };
  try {
    result = await updatePaymentRequestsBulk(ctx, updates);
  } catch (e) {
    console.error("[payment-request upload] 반영 실패:", e);
    return { ok: false, error: "반영 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.", rowErrors: errors };
  }

  const rowBySeqNo = new Map(updates.map((u) => [u.seqNo, u.row]));
  const notFoundErrors = result.notFoundSeqNos.map((seqNo) => ({
    row: rowBySeqNo.get(seqNo) ?? 0,
    message: `No ${seqNo}에 해당하는 지급요청을 찾을 수 없습니다.`,
  }));
  revalidatePath("/expenses");

  return {
    ok: true,
    message: `${result.updated}건 반영`,
    updated: result.updated,
    rowErrors: [...errors, ...notFoundErrors],
  };
}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/app/"(app)"/expenses/payment-request/upload-state.ts src/app/"(app)"/expenses/payment-request/actions.ts
git commit -m "feat(payment-request): 엑셀 재업로드 서버 액션 uploadPaymentRequestUpdatesAction 추가"
```

---

### Task 8: 화면 연동 — `PaymentRequestExcelUploadModal` 실제 제출

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestExcelUploadModal.tsx`

**Interfaces:**
- Consumes: Task 7의 `uploadPaymentRequestUpdatesAction`/`PaymentRequestUploadState`/`PAYMENT_REQUEST_UPLOAD_INIT`.
- Produces: 없음(최종 사용자 화면 변경). 호출부인 `PaymentRequestListPanel.tsx`는 이미 `onClose`만 넘기므로 변경 불필요.

이 태스크도 UI+서버액션 wiring이라 자동화 테스트가 없다(같은 패턴인 `PayeeUploadModal.tsx`도 테스트 없음). 타입 체크 + 수동 검증으로 확인한다.

- [ ] **Step 1: 모달 전체 교체**

`src/app/(app)/expenses/PaymentRequestExcelUploadModal.tsx` 전체를 아래 내용으로 교체:

```tsx
"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileDropzone } from "@/components/FileDropzone";
import { uploadPaymentRequestUpdatesAction } from "./payment-request/actions";
import { PAYMENT_REQUEST_UPLOAD_INIT } from "./payment-request/upload-state";

// 정산담당자/관리자가 등록된 지급요청을 엑셀로 다운로드해 지급일/지급여부만 채운 뒤
// 재업로드하는 팝업. No로 매칭된 건의 지급일/지급여부만 반영되고 나머지 컬럼은 무시된다.
export function PaymentRequestExcelUploadModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(uploadPaymentRequestUpdatesAction, PAYMENT_REQUEST_UPLOAD_INIT);

  // 반영이 1건이라도 생기면 목록 갱신, 오류 없이 성공하면 모달 닫기.
  useEffect(() => {
    if (state.updated && state.updated > 0) router.refresh();
    if (state.ok && state.updated && state.updated > 0 && !(state.rowErrors && state.rowErrors.length)) {
      onClose();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">⬆ 엑셀 업로드</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          다운로드한 엑셀에 지급일/지급여부만 채워서 업로드하면 해당 값만 반영됩니다.
        </p>

        <form action={formAction}>
          <FileDropzone name="file" accept=".xlsx" hint="지원 확장자: .xlsx" />

          <p className="mt-3 rounded bg-[var(--color-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
            반영 항목: 지급일, 지급여부
          </p>

          {state.ok && state.message && (
            <p className="mt-3 text-sm text-[var(--color-primary)]">{state.message}</p>
          )}
          {!state.ok && state.error && (
            <p className="mt-3 text-sm text-[var(--color-danger)]">{state.error}</p>
          )}
          {state.rowErrors && state.rowErrors.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto rounded border border-[var(--color-border)] px-5 py-2 text-xs text-[var(--color-danger)]">
              {state.rowErrors.map((e, i) => (
                <li key={i}>{e.row ? `${e.row}행: ` : ""}{e.message}</li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
            <button type="submit" disabled={pending} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
              {pending ? "업로드 중..." : "⬆ 업로드 실행"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + 전체 테스트**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 에러 없음.

Run: `npx vitest run`
Expected: 전체 PASS.

- [ ] **Step 3: 수동 검증**

1. `npm run dev`로 앱 실행, `SETTLEMENT` 또는 `ADMIN` 계정으로 `/expenses` → "지급요청" 탭.
2. 엑셀 다운로드 → 파일에 No/지급일/지급여부(맨 뒤 2열) 확인, 지급여부 셀 클릭 시 드롭다운(지급준비/지급완료)이 뜨는지 확인.
3. 한 행의 지급여부를 "지급완료"로 바꾸고 지급일을 채운 뒤 저장 → 엑셀 업로드 → 해당 건만 반영되고 목록의 "No"/지급일/지급여부가 갱신되는지 확인.
4. 다른 행은 손대지 않고 그대로 재업로드해도 오류 없이(지급일 공란 허용) 통과하는지 확인.
5. No를 존재하지 않는 값으로 바꿔 업로드 → 오류 행으로 안내되고 나머지는 반영되는지 확인.
6. 지급여부를 드롭다운 밖 임의 문자열로 바꿔 업로드 → 오류 안내 확인.
7. 지급완료로 바꾸면서 지급일을 비워 업로드 → "지급완료 처리하려면 지급일을 입력해야 합니다" 오류 확인.
8. PM 계정으로는 엑셀 업로드 버튼 자체가 보이지 않는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/app/"(app)"/expenses/PaymentRequestExcelUploadModal.tsx
git commit -m "feat(payment-request): 엑셀 재업로드 모달을 실제 서버 액션에 연결"
```
