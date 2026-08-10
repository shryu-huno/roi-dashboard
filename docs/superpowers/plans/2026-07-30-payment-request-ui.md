# 지급요청 탭 UI 뼈대 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM이 강사/업체 지급을 요청하는 "지급요청" 탭의 데이터 모델과 화면 전체 형태(목록/등록/상세보기)를 구현한다. 조회(필터+페이지네이션)는 실제 DB로 동작하고, 등록/수정/삭제/엑셀/공지사항 등 쓰기 로직은 다음 단계 스펙에서 구현하므로 이번 단계의 해당 버튼들은 클릭 시 안내만 표시한다.

**Architecture:** 신규 Prisma 모델 `PaymentRequest`(고객사 단위 RLS, `payment-list` 탭의 `Payee` 패턴과 달리 PM용 별도 마스킹이 없어 목록 조회 함수를 role 분기 없이 하나로 둔다) + `src/lib/data/payment-requests.ts` 데이터 계층 + `/expenses` 탭 배선 + 목록/등록/상세 화면 컴포넌트. 기존 지급 리스트(`PayeeListPanel`/`PayeePager`/`ClientCombobox`/`AllExpensesTab` 필터 폼) 패턴을 최대한 재사용한다.

**Tech Stack:** Next.js 16(App Router, RSC), Prisma 6 + PostgreSQL(RLS), React 19, TypeScript, Tailwind, Vitest.

## Global Constraints

- 금액 필드는 프로젝트 관례대로 `Int`(원 단위 정수).
- `TaxType` enum(청구방식)은 기존 것을 그대로 재사용, 신규 enum 추가하지 않는다.
- 신규 DB 접근은 전부 `withRLS(ctx, ...)` 트랜잭션을 통해서만 수행한다(직접 `prisma.*` 호출 금지, 기존 관례).
- `PaymentRequest` 목록 조회는 DB RLS(ClientManager 경유)가 PM 범위를 자동 제한하므로, `listPayees`/`listPayeesForPm`처럼 role별로 함수를 나누지 않는다.
- 이번 단계에서 실제로 동작하는 것은 조회(필터+페이지네이션)뿐이다. 등록 저장/수정/삭제/엑셀 다운로드·업로드/공지사항 작성은 버튼·모달·페이지는 존재하되 클릭 시 `alert("추후 구현 예정입니다.")`만 띄운다.
- 테스트는 데이터 계층(`src/lib/data/*.ts`)과 순수 함수(라벨/파서)만 vitest로 작성한다(레포에 React 컴포넌트 자동 테스트 관례 없음, `vitest.config.ts`가 `environment: "node"`). 화면 확인은 수동 검증으로 대체한다.
- 커밋은 태스크 단위로 나눈다(설계 스펙 `docs/superpowers/specs/2026-07-30-payment-request-ui-design.md` 참고).

---

## Task 1: Prisma 모델 + 마이그레이션(RLS 포함)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260730000000_add_payment_request/migration.sql`

**Interfaces:**
- Produces: `PaymentRequest` 모델(Prisma Client 타입 `PaymentRequest`, `PaymentRequestEntity`, `PaymentRequestStatus`), 이후 모든 태스크가 이 타입을 `@prisma/client`에서 import.

- [ ] **Step 1: `prisma/schema.prisma`에 enum과 모델 추가**

`enum TaxType { ... }` 블록(약 51~57행) 바로 다음에 아래 두 enum을 그대로 붙여넣는다(파일 내 `enum PayeeType`보다 뒤에 위치해도 상관없다 — Prisma는 선언 순서를 신경 쓰지 않는다):

```prisma
enum PaymentRequestEntity {
  HUNO       // 휴노
  HUNO_INC   // 휴노INC
}

enum PaymentRequestStatus {
  PREPARING  // 지급준비 (기본값)
  COMPLETED  // 지급완료
}
```

`model PayeeAttachment { ... }` 블록(270행) 다음에 추가:

```prisma
// PM이 강사/업체 지급을 요청하는 건별 레코드. Payee(마스터 정보)와는 느슨하게 연결—
// 지급 리스트에서 선택한 건은 payeeId로 연동, 지급 리스트에 없는 예외 건은 payeeId를 비우고
// bizName만 텍스트로 저장한다.
model PaymentRequest {
  id            String                @id @default(cuid())
  requestedAt   DateTime              @default(now())   // 신청일 (자동)
  requesterId   String                                   // 신청인
  requester     User                  @relation(fields: [requesterId], references: [id])
  entity        PaymentRequestEntity                     // 지급명의
  clientId      String                                   // 고객사
  client        Client                @relation(fields: [clientId], references: [id])
  payeeId       String?                                  // 지급 리스트 연동(있으면 FK)
  payee         Payee?                @relation(fields: [payeeId], references: [id])
  bizName       String                                   // 사업자명(이름) 스냅샷
  unitPrice     Int                                       // 단가
  transportFee  Int                                       // 교통비
  materialFee   Int                                       // 재료비
  count         Int                                       // 횟수
  amount        Int                                       // 지급액 = (단가+교통비+재료비)×횟수
  taxType       TaxType                                   // 청구방식
  memo          String                                    // 상세내역(비고)
  payDate       DateTime?                                 // 지급일 — 정산담당자가 이후 채움
  status        PaymentRequestStatus  @default(PREPARING) // 지급여부
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt
  deletedAt     DateTime?                                 // 소프트 삭제

  @@index([clientId])
  @@index([requesterId])
  @@index([status])
  @@index([payeeId])
}
```

`model User { ... }`의 `managedClients ClientManager[]` 다음 줄에 역방향 관계 추가:

```prisma
  paymentRequests PaymentRequest[]
```

`model Client { ... }`의 `corporateCardExpenses CorporateCardExpense[]` 다음 줄에 추가:

```prisma
  paymentRequests PaymentRequest[]
```

`model Payee { ... }`의 `attachments PayeeAttachment[]` 다음 줄에 추가:

```prisma
  paymentRequests PaymentRequest[]
```

- [ ] **Step 2: 마이그레이션 생성(적용 없이 SQL만)**

Run: `npx prisma migrate dev --name add_payment_request --create-only`

Prisma가 `prisma/migrations/20260730000000_add_payment_request/migration.sql`(또는 유사 타임스탬프 폴더명)에 `CreateEnum`/`CreateTable`/인덱스/FK SQL을 자동 생성한다. 폴더명이 다르게 생성되면 이후 언급하는 파일 경로를 실제 생성된 폴더명으로 맞춰 진행한다.

- [ ] **Step 3: 생성된 migration.sql 맨 끝에 RLS 정책 추가**

`Client`/`Expense`처럼 고객사 단위로 스코프하되(ADMIN/SETTLEMENT 전체, PM은 `ClientManager` 경유), Payee의 PM 쓰기 확장 정책 패턴을 참고해 PM은 자신이 담당하는 고객사에 한해 INSERT, 본인이 신청한 건만 UPDATE 가능하도록 아래 SQL을 파일 끝에 그대로 추가한다:

```sql
-- RLS: 고객사 단위 스코프(Client/Expense와 동일 패턴). ADMIN·SETTLEMENT는 전체,
-- PM은 ClientManager로 담당하는 고객사의 건만 조회/등록 가능. PM의 수정(UPDATE, 소프트삭제
-- 포함)은 본인이 신청한 건으로 한정한다(신청완료 이후 잠금 등 세부 규칙은 앱 레이어가 담당).
ALTER TABLE "PaymentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRequest" FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_request_select ON "PaymentRequest"
  FOR SELECT
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."clientId" = "PaymentRequest"."clientId"
        AND cm."userId" = current_setting('app.user_id', true)
    )
  );

CREATE POLICY payment_request_write_admin ON "PaymentRequest"
  FOR ALL
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'));

CREATE POLICY payment_request_insert_pm ON "PaymentRequest"
  FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', true) = 'PM'
    AND EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."clientId" = "PaymentRequest"."clientId"
        AND cm."userId" = current_setting('app.user_id', true)
    )
  );

CREATE POLICY payment_request_update_pm ON "PaymentRequest"
  FOR UPDATE
  USING (
    current_setting('app.user_role', true) = 'PM'
    AND "requesterId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.user_role', true) = 'PM'
    AND "requesterId" = current_setting('app.user_id', true)
  );
```

- [ ] **Step 4: 마이그레이션 적용 + Prisma Client 재생성**

Run: `npx prisma migrate dev`
Expected: `add_payment_request` 마이그레이션이 적용되고 "Already in sync" 또는 성공 메시지가 뜬다. `postinstall`이 `prisma generate`를 실행하지만, 방금 스키마를 바꿨으므로 명시적으로 한 번 더 실행: `npx prisma generate`.

- [ ] **Step 5: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat(payment-request): PaymentRequest 모델과 RLS 정책 추가

PM이 강사/업체 지급을 요청하는 지급요청 탭의 데이터 모델. Client 단위로
스코프되는 RLS(ADMIN/SETTLEMENT 전체, PM은 담당 고객사·본인 신청 건만).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 2: 데이터 계층 — `src/lib/data/payment-requests.ts`

**Files:**
- Create: `src/lib/data/payment-requests.ts`
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: `withRLS`, `RlsContext`(`@/lib/rls`), `PaymentRequestEntity`/`PaymentRequestStatus`/`TaxType`/`Prisma`(`@prisma/client`).
- Produces:
  - `PAYMENT_REQUEST_PAGE_SIZE: number`
  - `type PaymentRequestFilter = { payDateFrom?: Date; payDateTo?: Date; clientId?: string; entity?: PaymentRequestEntity; status?: PaymentRequestStatus; bizName?: string }`
  - `type PaymentRequestRow = { id: string; requestedAt: Date; requesterId: string; requesterName: string; entity: PaymentRequestEntity; clientId: string; clientName: string; bizName: string; unitPrice: number; transportFee: number; materialFee: number; count: number; amount: number; taxType: TaxType; memo: string; payDate: Date | null; status: PaymentRequestStatus }`
  - `type PaymentRequestPage<T> = { rows: T[]; page: number; totalPages: number }`
  - `parsePaymentRequestPage(value: string | undefined): number`
  - `parsePaymentRequestEntity(value: string | undefined): PaymentRequestEntity | undefined`
  - `parsePaymentRequestStatus(value: string | undefined): PaymentRequestStatus | undefined`
  - `parsePaymentRequestDateParam(value: string | undefined): Date | undefined`
  - `listPaymentRequests(ctx: RlsContext, filter?: PaymentRequestFilter, page = 1): Promise<PaymentRequestPage<PaymentRequestRow>>`

- [ ] **Step 1: 테스트부터 작성**

```typescript
// test/data-payment-requests.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import {
  listPaymentRequests, parsePaymentRequestPage, parsePaymentRequestEntity,
  parsePaymentRequestStatus, parsePaymentRequestDateParam, PAYMENT_REQUEST_PAGE_SIZE,
} from "@/lib/data/payment-requests";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.paymentRequest.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

async function seed() {
  const admin = await prisma.user.create({ data: { email: "admin@huno.kr", role: "ADMIN", status: "ACTIVE" } });
  const pmA = await prisma.user.create({ data: { email: "pma@huno.kr", name: "김PM", role: "PM", status: "ACTIVE" } });
  const pmB = await prisma.user.create({ data: { email: "pmb@huno.kr", name: "이PM", role: "PM", status: "ACTIVE" } });
  const clientA = await withRLS(ADMIN, (tx) => tx.client.create({
    data: { name: "A사", businessType: "휴노", managers: { create: [{ userId: pmA.id }] } },
  }));
  const clientB = await withRLS(ADMIN, (tx) => tx.client.create({
    data: { name: "B사", businessType: "휴노INC", managers: { create: [{ userId: pmB.id }] } },
  }));
  return { admin, pmA, pmB, clientA, clientB };
}

function baseInput(overrides: Partial<{
  requesterId: string; entity: "HUNO" | "HUNO_INC"; clientId: string; bizName: string;
  unitPrice: number; transportFee: number; materialFee: number; count: number;
  taxType: "TAX_INVOICE" | "BUSINESS_INCOME"; memo: string; payDate: Date | null; status: "PREPARING" | "COMPLETED";
}>) {
  return {
    requesterId: overrides.requesterId!,
    entity: overrides.entity ?? "HUNO",
    clientId: overrides.clientId!,
    bizName: overrides.bizName ?? "홍길동",
    unitPrice: overrides.unitPrice ?? 100000,
    transportFee: overrides.transportFee ?? 0,
    materialFee: overrides.materialFee ?? 0,
    count: overrides.count ?? 1,
    amount: ((overrides.unitPrice ?? 100000) + (overrides.transportFee ?? 0) + (overrides.materialFee ?? 0)) * (overrides.count ?? 1),
    taxType: overrides.taxType ?? "BUSINESS_INCOME",
    memo: overrides.memo ?? "테스트 지급요청",
    payDate: overrides.payDate ?? null,
    status: overrides.status ?? "PREPARING",
  };
}

describe("payment-requests 데이터 계층", () => {
  beforeEach(reset);

  it("ADMIN은 전체 지급요청을 조회한다", async () => {
    const { admin, pmA, clientA, clientB } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: admin.id, clientId: clientB.id }) }));
    const { rows, totalPages } = await listPaymentRequests(ADMIN);
    expect(rows.length).toBe(2);
    expect(totalPages).toBe(1);
  });

  it("PM은 자신이 담당하는 고객사의 지급요청만 조회한다(RLS)", async () => {
    const { pmA, pmB, clientA, clientB } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A사건" }) }));
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmB.id, clientId: clientB.id, bizName: "B사건" }) }));
    const { rows } = await listPaymentRequests({ userId: pmA.id, role: "PM" });
    expect(rows.map((r) => r.bizName)).toEqual(["A사건"]);
  });

  it("신청인 이름과 고객사명을 조인해서 반환한다", async () => {
    const { pmA, clientA } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));
    const { rows: [row] } = await listPaymentRequests(ADMIN);
    expect(row.requesterName).toBe("김PM");
    expect(row.clientName).toBe("A사");
  });

  it("고객사/지급명의/지급여부/사업자명 필터가 동작한다", async () => {
    const { pmA, clientA, clientB } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, entity: "HUNO", bizName: "홍길동", status: "PREPARING" }) }));
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientB.id, entity: "HUNO_INC", bizName: "김철수", status: "COMPLETED" }) }));

    expect((await listPaymentRequests(ADMIN, { clientId: clientA.id })).rows).toHaveLength(1);
    expect((await listPaymentRequests(ADMIN, { entity: "HUNO_INC" })).rows).toHaveLength(1);
    expect((await listPaymentRequests(ADMIN, { status: "COMPLETED" })).rows[0].bizName).toBe("김철수");
    expect((await listPaymentRequests(ADMIN, { bizName: "길동" })).rows).toHaveLength(1);
  });

  it("지급일 기간 필터는 payDate가 없는 건을 제외한다", async () => {
    const { pmA, clientA } = await seed();
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "미지급", payDate: null }) }));
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "8월지급", payDate: new Date("2026-08-05") }) }));

    const { rows } = await listPaymentRequests(ADMIN, {
      payDateFrom: new Date("2026-08-01"),
      payDateTo: new Date("2026-08-31"),
    });
    expect(rows.map((r) => r.bizName)).toEqual(["8월지급"]);
  });

  it("페이지네이션: PAGE_SIZE+1건이면 2페이지로 나뉜다", async () => {
    const { pmA, clientA } = await seed();
    await withRLS(ADMIN, async (tx) => {
      for (let i = 0; i < PAYMENT_REQUEST_PAGE_SIZE + 1; i++) {
        await tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: `건${i}` }) });
      }
    });
    const page1 = await listPaymentRequests(ADMIN, undefined, 1);
    expect(page1.rows).toHaveLength(PAYMENT_REQUEST_PAGE_SIZE);
    expect(page1.totalPages).toBe(2);
    const page2 = await listPaymentRequests(ADMIN, undefined, 2);
    expect(page2.rows).toHaveLength(1);
  });

  it("RLS: PM은 담당하는 고객사에만 등록(INSERT)할 수 있다", async () => {
    const { pmA, clientA } = await seed();
    const created = await withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
      tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }),
    );
    expect(created.clientId).toBe(clientA.id);
  });

  it("RLS: PM은 담당하지 않는 고객사에는 등록(INSERT)할 수 없다", async () => {
    const { pmA, clientB } = await seed();
    await expect(
      withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
        tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientB.id }) }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("RLS: PM은 본인이 신청한 건만 수정(UPDATE)할 수 있다", async () => {
    const { pmA, pmB, clientA, clientB } = await seed();
    const ownRow = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));
    const othersRow = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmB.id, clientId: clientB.id }) }));

    const updated = await withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
      tx.paymentRequest.update({ where: { id: ownRow.id }, data: { memo: "PM이 수정" } }),
    );
    expect(updated.memo).toBe("PM이 수정");

    await expect(
      withRLS({ userId: pmA.id, role: "PM" }, (tx) =>
        tx.paymentRequest.update({ where: { id: othersRow.id }, data: { memo: "해킹 시도" } }),
      ),
    ).rejects.toThrow(/no record was found for an update/i);
  });

  it("RLS: SETTLEMENT은 고객사·신청인 무관하게 등록·수정할 수 있다", async () => {
    const { pmA, clientA } = await seed();
    const SETTLEMENT = { userId: "s1", role: "SETTLEMENT" as const };
    const created = await withRLS(SETTLEMENT, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));
    const updated = await withRLS(SETTLEMENT, (tx) => tx.paymentRequest.update({ where: { id: created.id }, data: { status: "COMPLETED" } }));
    expect(updated.status).toBe("COMPLETED");
  });

  it("parsePaymentRequestPage: 0/음수/문자/undefined는 1로 클램프", () => {
    expect(parsePaymentRequestPage(undefined)).toBe(1);
    expect(parsePaymentRequestPage("0")).toBe(1);
    expect(parsePaymentRequestPage("-3")).toBe(1);
    expect(parsePaymentRequestPage("abc")).toBe(1);
    expect(parsePaymentRequestPage("2")).toBe(2);
  });

  it("parsePaymentRequestEntity/Status: 알 수 없는 값은 undefined", () => {
    expect(parsePaymentRequestEntity("HUNO")).toBe("HUNO");
    expect(parsePaymentRequestEntity("HACKED")).toBeUndefined();
    expect(parsePaymentRequestStatus("COMPLETED")).toBe("COMPLETED");
    expect(parsePaymentRequestStatus("")).toBeUndefined();
  });

  it("parsePaymentRequestDateParam: YYYY-MM-DD만 파싱, 그 외는 undefined", () => {
    expect(parsePaymentRequestDateParam("2026-08-05")?.toISOString().slice(0, 10)).toBe("2026-08-05");
    expect(parsePaymentRequestDateParam("")).toBeUndefined();
    expect(parsePaymentRequestDateParam("not-a-date")).toBeUndefined();
    expect(parsePaymentRequestDateParam(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: FAIL — `Cannot find module '@/lib/data/payment-requests'`.

- [ ] **Step 3: 구현**

```typescript
// src/lib/data/payment-requests.ts
import type { PaymentRequestEntity, PaymentRequestStatus, Prisma, TaxType } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";

export const PAYMENT_REQUEST_PAGE_SIZE = 50;

const PAYMENT_REQUEST_ENTITIES: readonly PaymentRequestEntity[] = ["HUNO", "HUNO_INC"];
const PAYMENT_REQUEST_STATUSES: readonly PaymentRequestStatus[] = ["PREPARING", "COMPLETED"];

// URL 쿼리 파라미터(page)를 파싱. 1 미만이거나 정수가 아니면 1(첫 페이지)로 클램프.
export function parsePaymentRequestPage(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

// 알 수 없는 값(URL 조작 등)은 undefined 반환 — 호출부가 필터를 무시하도록.
export function parsePaymentRequestEntity(value: string | undefined): PaymentRequestEntity | undefined {
  return PAYMENT_REQUEST_ENTITIES.find((e) => e === value);
}

export function parsePaymentRequestStatus(value: string | undefined): PaymentRequestStatus | undefined {
  return PAYMENT_REQUEST_STATUSES.find((s) => s === value);
}

// <input type="date">의 "YYYY-MM-DD" 형식만 허용. 그 외(빈 값, 잘못된 형식)는 undefined.
export function parsePaymentRequestDateParam(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export type PaymentRequestFilter = {
  payDateFrom?: Date;
  payDateTo?: Date;
  clientId?: string;
  entity?: PaymentRequestEntity;
  status?: PaymentRequestStatus;
  bizName?: string;
};

// 목록 화면(11개 고정 컬럼)과 상세보기 모달이 함께 쓰는 행 타입. 상세 전용 필드(단가/교통비/
// 재료비/횟수/청구방식/상세내역)도 함께 내려보내 상세보기가 별도 조회 없이 이 행을 그대로 쓴다.
export type PaymentRequestRow = {
  id: string;
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

export type PaymentRequestPage<T> = { rows: T[]; page: number; totalPages: number };

function buildWhere(filter?: PaymentRequestFilter): Prisma.PaymentRequestWhereInput {
  const where: Prisma.PaymentRequestWhereInput = { deletedAt: null };
  if (!filter) return where;
  if (filter.clientId) where.clientId = filter.clientId;
  if (filter.entity) where.entity = filter.entity;
  if (filter.status) where.status = filter.status;
  if (filter.bizName?.trim()) where.bizName = { contains: filter.bizName.trim(), mode: "insensitive" };
  if (filter.payDateFrom || filter.payDateTo) {
    where.payDate = {
      ...(filter.payDateFrom ? { gte: filter.payDateFrom } : {}),
      ...(filter.payDateTo ? { lte: filter.payDateTo } : {}),
    };
  }
  return where;
}

// RLS(ClientManager 경유)가 PM 범위를 자동 제한하므로 role별 함수 분기가 필요 없다
// (Payee와 달리 필드 마스킹도 없다 — 화면 차이는 엑셀 다운로드 버튼 노출 여부뿐).
export async function listPaymentRequests(
  ctx: RlsContext,
  filter?: PaymentRequestFilter,
  page = 1,
): Promise<PaymentRequestPage<PaymentRequestRow>> {
  const where = buildWhere(filter);
  const skip = (page - 1) * PAYMENT_REQUEST_PAGE_SIZE;

  const fetchPage = (p: number) => withRLS(ctx, async (tx) => {
    const [rows, totalCount] = await Promise.all([
      tx.paymentRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        include: { requester: { select: { name: true, email: true } }, client: { select: { name: true } } },
        skip: (p - 1) * PAYMENT_REQUEST_PAGE_SIZE,
        take: PAYMENT_REQUEST_PAGE_SIZE,
      }),
      tx.paymentRequest.count({ where }),
    ]);
    return { rows, totalCount };
  });

  let { rows, totalCount } = await fetchPage(page);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAYMENT_REQUEST_PAGE_SIZE));
  // 삭제 등으로 결과가 줄어 요청한 page가 범위를 벗어나면 마지막 페이지로 클램프해 재조회한다.
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  if (clampedPage !== page) {
    ({ rows, totalCount } = await fetchPage(clampedPage));
  }

  const mapped = rows.map((r) => ({
    id: r.id,
    requestedAt: r.requestedAt,
    requesterId: r.requesterId,
    requesterName: r.requester.name ?? r.requester.email,
    entity: r.entity,
    clientId: r.clientId,
    clientName: r.client.name,
    bizName: r.bizName,
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
  return { rows: mapped, page: clampedPage, totalPages };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: PASS(전체 13건).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "$(cat <<'EOF'
feat(payment-request): 지급요청 목록 조회 데이터 계층 추가

필터(지급일 기간/고객사/지급명의/지급여부/사업자명) + 페이지네이션.
RLS가 PM 범위를 자동 제한해 role별 함수 분기 없이 하나로 구현.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 3: `listPayeeOptions` 추가 (지급 리스트 검색용)

**Files:**
- Modify: `src/lib/data/payees.ts`
- Modify: `test/data-payees.test.ts`

**Interfaces:**
- Produces: `type PayeeOption = { id: string; keyId: string; bizName: string }`, `listPayeeOptions(ctx: RlsContext): Promise<PayeeOption[]>` — Task 9(PayeeCombobox)/Task 12(등록 페이지)가 사용.

- [ ] **Step 1: 실패하는 테스트 추가**

`test/data-payees.test.ts`의 `describe("payees 데이터 계층", ...)` 블록 안, 마지막 `it(...)` 다음에 추가(기존 import 줄의 `listPayees, listPayeesForExport, ...`에 `listPayeeOptions`도 추가):

```typescript
// import 수정: 기존 목록에 listPayeeOptions 추가
// import { createPayeesBulk, listPayees, listPayeesForExport, listPayeesForPm, findPayeeByBizNumber, listPayeeOptions, ... } from "@/lib/data/payees";

it("listPayeeOptions는 역할 무관하게 id/keyId/bizName만 반환한다(민감정보 없음)", async () => {
  await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "업체1"), input("9001011234567", "INSTRUCTOR", "강사1")]);
  const pmOptions = await listPayeeOptions({ userId: "pm1", role: "PM" });
  expect(pmOptions.sort((a, b) => a.bizName.localeCompare(b.bizName))).toEqual([
    { id: expect.any(String), keyId: "b001", bizName: "업체1" },
    { id: expect.any(String), keyId: "a001", bizName: "강사1" },
  ].sort((a, b) => a.bizName.localeCompare(b.bizName)));
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/data-payees.test.ts -t "listPayeeOptions"`
Expected: FAIL — `listPayeeOptions is not a function` (또는 import 에러).

- [ ] **Step 3: 구현 — `src/lib/data/payees.ts` 파일 끝(`softDeletePayees` 함수 다음)에 추가**

```typescript
// 지급요청 등록 화면의 사업자명(이름) 검색 콤보박스용 — 민감정보(계좌/사업자번호) 없이
// id/keyId/bizName만. Payee의 SELECT RLS(payee_select)는 전 역할 허용이라 role 분기가 필요 없다.
export type PayeeOption = { id: string; keyId: string; bizName: string };

export function listPayeeOptions(ctx: RlsContext): Promise<PayeeOption[]> {
  return withRLS(ctx, (tx) =>
    tx.payee.findMany({
      where: { deletedAt: null },
      select: { id: true, keyId: true, bizName: true },
      orderBy: { bizName: "asc" },
    }),
  );
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS(전체).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "$(cat <<'EOF'
feat(payees): 지급요청 등록용 listPayeeOptions 추가

지급요청 등록 화면의 사업자명 검색 콤보박스가 쓸 최소 필드(id/keyId/bizName) 조회.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 4: 라벨 — 지급명의/지급여부

**Files:**
- Modify: `src/lib/labels.ts`
- Modify: `test/labels.test.ts`

**Interfaces:**
- Produces: `PAYMENT_REQUEST_ENTITY_LABELS`, `paymentRequestEntityLabel(e)`, `PAYMENT_REQUEST_ENTITY_BY_LABEL`, `PAYMENT_REQUEST_STATUS_LABELS`, `paymentRequestStatusLabel(s)` — Task 8/10/12/13이 드롭다운·뱃지 표시에 사용.

- [ ] **Step 1: 실패하는 테스트 추가**

`test/labels.test.ts` 파일 끝에 추가(파일이 없으면 기존 내용 구조를 그대로 따라 새 `describe` 블록만 추가):

```typescript
import { paymentRequestEntityLabel, paymentRequestStatusLabel } from "@/lib/labels";

describe("지급요청 라벨", () => {
  it("지급명의 라벨", () => {
    expect(paymentRequestEntityLabel("HUNO")).toBe("휴노");
    expect(paymentRequestEntityLabel("HUNO_INC")).toBe("휴노INC");
  });
  it("지급여부 라벨", () => {
    expect(paymentRequestStatusLabel("PREPARING")).toBe("지급준비");
    expect(paymentRequestStatusLabel("COMPLETED")).toBe("지급완료");
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/labels.test.ts -t "지급요청 라벨"`
Expected: FAIL — import 에러.

- [ ] **Step 3: 구현 — `src/lib/labels.ts` 파일 끝에 추가**

파일 상단 import에 `PaymentRequestEntity, PaymentRequestStatus` 추가:

```typescript
import type { PayeeType, TaxType, PaymentRequestEntity, PaymentRequestStatus } from "@prisma/client";
```

파일 끝에 추가:

```typescript
export const PAYMENT_REQUEST_ENTITY_LABELS = ["휴노", "휴노INC"] as const;

export function paymentRequestEntityLabel(e: PaymentRequestEntity): string {
  return e === "HUNO" ? "휴노" : "휴노INC";
}

export const PAYMENT_REQUEST_ENTITY_BY_LABEL: Record<(typeof PAYMENT_REQUEST_ENTITY_LABELS)[number], PaymentRequestEntity> = {
  "휴노": "HUNO",
  "휴노INC": "HUNO_INC",
};

export const PAYMENT_REQUEST_STATUS_LABELS = ["지급준비", "지급완료"] as const;

export function paymentRequestStatusLabel(s: PaymentRequestStatus): string {
  return s === "PREPARING" ? "지급준비" : "지급완료";
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/labels.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/labels.ts test/labels.test.ts
git commit -m "$(cat <<'EOF'
feat(payment-request): 지급명의/지급여부 라벨 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 5: `PaymentRequestPager.tsx`

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestPager.tsx`

**Interfaces:**
- Consumes: 없음(순수 UI, `next/link`만 사용).
- Produces: `PaymentRequestPager({ page, totalPages, filterParams }: { page: number; totalPages: number; filterParams: Record<string, string> })` — Task 8이 사용.

`PayeePager`(`field`/`q` 2개 파라미터 고정)와 달리 지급요청은 필터가 5개라 임의의 파라미터 묶음을 받는 형태로 만든다.

- [ ] **Step 1: 구현**

```tsx
// src/app/(app)/expenses/PaymentRequestPager.tsx
import Link from "next/link";

function pageHref(filterParams: Record<string, string>, page: number): string {
  const params = new URLSearchParams({ tab: "payment-request", ...filterParams, page: String(page) });
  return `/expenses?${params.toString()}`;
}

// 이전/다음 + 현재 페이지 주변 최대 7개 번호 링크. totalPages가 1 이하면 아무것도 렌더링하지 않는다.
function pageWindow(page: number, totalPages: number): number[] {
  const windowSize = 7;
  let start = Math.max(1, page - 3);
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return pages;
}

export function PaymentRequestPager({
  page,
  totalPages,
  filterParams,
}: {
  page: number;
  totalPages: number;
  filterParams: Record<string, string>;
}) {
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);
  const linkClass = "rounded border border-[var(--color-border)] px-3 py-1.5 text-sm";
  const disabledClass = "cursor-not-allowed rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] opacity-50";
  const currentClass = "rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white";

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-center gap-1">
      {page > 1 ? (
        <Link href={pageHref(filterParams, page - 1)} className={linkClass}>이전</Link>
      ) : (
        <span className={disabledClass}>이전</span>
      )}
      {pages.map((p) =>
        p === page ? (
          <span key={p} className={currentClass}>{p}</span>
        ) : (
          <Link key={p} href={pageHref(filterParams, p)} className={linkClass}>{p}</Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={pageHref(filterParams, page + 1)} className={linkClass}>다음</Link>
      ) : (
        <span className={disabledClass}>다음</span>
      )}
    </nav>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 이 파일 관련 에러 없음(아직 어디서도 import하지 않으므로 미사용 경고는 없음 — Next.js는 미사용 파일에 대해 에러를 내지 않는다).

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestPager.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 지급요청 목록 페이지네이션 컴포넌트 추가

PayeePager와 동일한 UI지만 필터 파라미터가 5개라 임의 파라미터 묶음을 받는다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 6: `PaymentRequestNoticeBanner.tsx`

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx`

**Interfaces:**
- Produces: `PaymentRequestNoticeBanner()` — Task 8이 목록 최상단에 배치. 이번 단계는 빈 상태만(공지사항 모델/CRUD는 범위 밖).

- [ ] **Step 1: 구현**

```tsx
// src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx
// 공지사항 CRUD(정산담당자/관리자 작성)는 다음 단계 스펙에서 구현. 이번 단계는 자리만 배치.
export function PaymentRequestNoticeBanner() {
  return (
    <div className="mb-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] px-4 py-3 text-sm text-[var(--color-muted)]">
      📢 등록된 공지가 없습니다.
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 공지사항 배너 자리 배치(빈 상태)

작성/수정/삭제는 범위 밖 — 다음 단계 스펙에서 구현.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 7: `PayeeCombobox.tsx` (사업자명 검색 콤보박스)

**Files:**
- Create: `src/components/PayeeCombobox.tsx`

**Interfaces:**
- Consumes: `PayeeOption`(Task 3, `@/lib/data/payees`).
- Produces: `PayeeCombobox({ payees, selectedId, onSelect, className }: { payees: PayeeOption[]; selectedId: string | null; onSelect: (payee: PayeeOption | null) => void; className?: string })` — Task 8(등록 행 편집기)이 사용. `ClientCombobox`와 달리 GET 폼용 hidden input이 아니라 controlled 컴포넌트(부모가 React 상태로 행 배열을 관리하기 때문).

- [ ] **Step 1: 구현**

```tsx
// src/components/PayeeCombobox.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { PayeeOption } from "@/lib/data/payees";

// 사업자명(이름) 검색형 선택. 동명이인/동일업체명 구분을 위해 후보 목록에는
// "이름 (고유번호)"를 보여주고, 선택하면 입력창에는 이름만 남긴다.
export function PayeeCombobox({
  payees,
  selectedId,
  onSelect,
  className = "w-full",
}: {
  payees: PayeeOption[];
  selectedId: string | null;
  onSelect: (payee: PayeeOption | null) => void;
  className?: string;
}) {
  const selected = payees.find((p) => p.id === selectedId) ?? null;
  const [query, setQuery] = useState(selected?.bizName ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 부모가 selectedId를 바꾸면(예: 다른 행 데이터 로드) 입력값을 동기화.
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    setQuery(selected?.bizName ?? "");
    setOpen(false);
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? payees.filter((p) => p.bizName.toLowerCase().includes(q)) : payees;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function select(p: PayeeOption) {
    setQuery(p.bizName);
    setOpen(false);
    onSelect(p);
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onSelect(null);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && filtered[highlight]) {
              e.preventDefault();
              select(filtered[highlight]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="사업자명(이름) 검색"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        className="w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-sm"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(p);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2 py-1.5 text-left text-sm hover:bg-[var(--color-border)] ${
                  i === highlight ? "bg-[var(--color-border)]" : ""
                }`}
              >
                {p.bizName} ({p.keyId})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/components/PayeeCombobox.tsx
git commit -m "$(cat <<'EOF'
feat(payment-request): 사업자명 검색 콤보박스 컴포넌트 추가

동명이인/동일업체명 구분을 위해 후보는 "이름 (고유번호)"로, 선택 후에는
이름만 표시. ClientCombobox와 달리 controlled 컴포넌트로 구현(행 배열
상태를 부모가 관리).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 8: `PaymentRequestListPanel.tsx` + 탭 배선

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestListPanel.tsx`
- Modify: `src/app/(app)/expenses/page.tsx`

**Interfaces:**
- Consumes: `PaymentRequestRow`/`listPaymentRequests`/`parsePaymentRequest*`(Task 2), `PaymentRequestPager`(Task 5), `PaymentRequestNoticeBanner`(Task 6), `ClientCombobox`(기존), `PAYMENT_REQUEST_ENTITY_LABELS`/`paymentRequestEntityLabel`/`PAYMENT_REQUEST_STATUS_LABELS`/`paymentRequestStatusLabel`(Task 4), `formatWon`(`@/lib/format`).
- Produces: `PaymentRequestListPanel` 컴포넌트(props 아래 명시) — Task 13이 "+ 등록" 버튼 동작을 이 파일에서 이어서 완성한다(이번 태스크에서는 알림 스텁으로 둔다).

- [ ] **Step 1: `page.tsx`에 필터 파라미터 타입 추가 + 탭 분기 추가**

`searchParams` 타입(`Promise<{ tab?: string; clientId?: string; from?: string; to?: string; field?: string; q?: string; page?: string }>`)에 지급요청 전용 파라미터 추가:

```typescript
searchParams: Promise<{
  tab?: string; clientId?: string; from?: string; to?: string; field?: string; q?: string; page?: string;
  payDateFrom?: string; payDateTo?: string; entity?: string; status?: string; bizName?: string;
}>;
```

`PlaceholderTab` 함수 바로 위에 새 async 컴포넌트 추가(기존 `PaymentListTab` 다음):

```tsx
// 지급요청 탭 본문 — 조회(필터+페이지네이션)만 실동작, 나머지 쓰기 액션은 화면만(다음 단계에서 구현).
async function PaymentRequestTab({
  sp,
  user,
}: {
  sp: {
    clientId?: string; page?: string;
    payDateFrom?: string; payDateTo?: string; entity?: string; status?: string; bizName?: string;
  };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const [clients, payees] = await Promise.all([listClients(ctx), listPayeeOptions(ctx)]);

  const filter = {
    payDateFrom: parsePaymentRequestDateParam(sp.payDateFrom),
    payDateTo: parsePaymentRequestDateParam(sp.payDateTo),
    clientId: sp.clientId || undefined,
    entity: parsePaymentRequestEntity(sp.entity),
    status: parsePaymentRequestStatus(sp.status),
    bizName: sp.bizName || undefined,
  };
  const page = parsePaymentRequestPage(sp.page);
  const result = await listPaymentRequests(ctx, filter, page);

  return (
    <PaymentRequestListPanel
      rows={result.rows}
      page={result.page}
      totalPages={result.totalPages}
      clients={clients.map((c) => ({ id: c.id, name: c.name, businessType: c.businessType }))}
      payees={payees}
      filterValues={{
        payDateFrom: sp.payDateFrom ?? "",
        payDateTo: sp.payDateTo ?? "",
        clientId: sp.clientId ?? "",
        entity: sp.entity ?? "",
        status: sp.status ?? "",
        bizName: sp.bizName ?? "",
      }}
      role={user.role!}
      currentUserId={user.id}
    />
  );
}
```

파일 상단 import에 추가:

```typescript
import { listPayeeOptions } from "@/lib/data/payees";
import {
  listPaymentRequests, parsePaymentRequestPage, parsePaymentRequestEntity,
  parsePaymentRequestStatus, parsePaymentRequestDateParam,
} from "@/lib/data/payment-requests";
import { PaymentRequestListPanel } from "./PaymentRequestListPanel";
```

`ExpensesPage`의 분기 스위치에서 `payment-list` 분기 다음에 추가:

```tsx
      ) : currentTab === "payment-list" ? (
        <PaymentListTab sp={sp} user={user} />
      ) : currentTab === "payment-request" ? (
        <PaymentRequestTab sp={sp} user={user} />
      ) : (
```

- [ ] **Step 2: `PaymentRequestListPanel.tsx` 구현**

```tsx
// src/app/(app)/expenses/PaymentRequestListPanel.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { PAYMENT_REQUEST_PAGE_SIZE, type PaymentRequestRow } from "@/lib/data/payment-requests";
import type { PayeeOption } from "@/lib/data/payees";
import type { AppRole } from "@/lib/auth/rbac";
import { ClientCombobox } from "@/components/ClientCombobox";
import { PaymentRequestPager } from "./PaymentRequestPager";
import { PaymentRequestNoticeBanner } from "./PaymentRequestNoticeBanner";
import { formatWon } from "@/lib/format";
import {
  PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL, paymentRequestEntityLabel,
  PAYMENT_REQUEST_STATUS_LABELS, paymentRequestStatusLabel,
} from "@/lib/labels";

type FilterValues = {
  payDateFrom: string; payDateTo: string; clientId: string; entity: string; status: string; bizName: string;
};

const NOT_IMPLEMENTED = "추후 구현 예정입니다.";

function dateStr(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "-";
}

export function PaymentRequestListPanel({
  rows,
  page,
  totalPages,
  clients,
  payees: _payees,
  filterValues,
  role,
  currentUserId: _currentUserId,
}: {
  rows: PaymentRequestRow[];
  page: number;
  totalPages: number;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  filterValues: FilterValues;
  role: AppRole;
  currentUserId: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const canExport = role === "ADMIN" || role === "SETTLEMENT";
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  const filterParams: Record<string, string> = {
    payDateFrom: filterValues.payDateFrom,
    payDateTo: filterValues.payDateTo,
    clientId: filterValues.clientId,
    entity: filterValues.entity,
    status: filterValues.status,
    bizName: filterValues.bizName,
  };

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <PaymentRequestNoticeBanner />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] p-4">
        <input type="hidden" name="tab" value="payment-request" />
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          지급일
          <span className="mt-1 flex items-center gap-1">
            <input type="date" name="payDateFrom" defaultValue={filterValues.payDateFrom} className="w-40 rounded border border-[var(--color-border)] px-2 py-2 text-sm" />
            ~
            <input type="date" name="payDateTo" defaultValue={filterValues.payDateTo} className="w-40 rounded border border-[var(--color-border)] px-2 py-2 text-sm" />
          </span>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <ClientCombobox clients={clients} defaultClientId={filterValues.clientId || undefined} className="mt-1 w-48" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          지급명의
          <select name="entity" defaultValue={filterValues.entity} className="mt-1 w-32 rounded border border-[var(--color-border)] px-2 py-2 text-sm">
            <option value="">전체</option>
            {PAYMENT_REQUEST_ENTITY_LABELS.map((label) => (
              <option key={label} value={PAYMENT_REQUEST_ENTITY_BY_LABEL[label]}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          지급여부
          <select name="status" defaultValue={filterValues.status} className="mt-1 w-32 rounded border border-[var(--color-border)] px-2 py-2 text-sm">
            <option value="">전체</option>
            <option value="PREPARING">{PAYMENT_REQUEST_STATUS_LABELS[0]}</option>
            <option value="COMPLETED">{PAYMENT_REQUEST_STATUS_LABELS[1]}</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          사업자명(이름)
          <input type="text" name="bizName" defaultValue={filterValues.bizName} placeholder="검색어 입력" className="mt-1 w-40 rounded border border-[var(--color-border)] px-2 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">🔍 조회</button>
      </form>

      <div className="mb-4 flex justify-end gap-2">
        {canExport && (
          <button type="button" onClick={() => alert(NOT_IMPLEMENTED)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            📗 엑셀 다운로드
          </button>
        )}
        <button
          type="button"
          onClick={() => alert(NOT_IMPLEMENTED)}
          disabled={selected.size === 0}
          className="rounded border border-[var(--color-border)] px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          🗓️ 일괄수정{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
        </button>
        <button
          type="button"
          onClick={() => alert(NOT_IMPLEMENTED)}
          disabled={selected.size === 0}
          className="rounded bg-[var(--color-danger)] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          🗑️ 삭제{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
        </button>
        {role === "PM" ? (
          <Link href="/expenses/payment-request/new" className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white">
            + 등록
          </Link>
        ) : (
          <button type="button" onClick={() => alert(NOT_IMPLEMENTED)} className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white">
            + 등록
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th className="w-10 whitespace-nowrap px-3 py-2 align-middle">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체선택" />
              </th>
              <th className="whitespace-nowrap px-3 py-2">No</th>
              <th className="whitespace-nowrap px-3 py-2">신청일</th>
              <th className="whitespace-nowrap px-3 py-2">신청인</th>
              <th className="whitespace-nowrap px-3 py-2">지급명의</th>
              <th className="whitespace-nowrap px-3 py-2">고객사</th>
              <th className="whitespace-nowrap px-3 py-2">사업자명(이름)</th>
              <th className="whitespace-nowrap px-3 py-2">지급액</th>
              <th className="whitespace-nowrap px-3 py-2">지급일</th>
              <th className="whitespace-nowrap px-3 py-2">지급여부</th>
              <th className="whitespace-nowrap px-3 py-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-b border-[var(--color-border)] ${selected.has(r.id) ? "bg-[var(--color-hover)]" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2 align-middle">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} aria-label={`${r.bizName} 선택`} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">{(page - 1) * PAYMENT_REQUEST_PAGE_SIZE + i + 1}</td>
                <td className="whitespace-nowrap px-3 py-2">{dateStr(r.requestedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.requesterName}</td>
                <td className="whitespace-nowrap px-3 py-2">{paymentRequestEntityLabel(r.entity)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.clientName}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.bizName}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatWon(r.amount)}</td>
                <td className="whitespace-nowrap px-3 py-2">{dateStr(r.payDate)}</td>
                <td className="whitespace-nowrap px-3 py-2">{paymentRequestStatusLabel(r.status)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="flex justify-center gap-2">
                    <button type="button" onClick={() => alert(NOT_IMPLEMENTED)} className="text-[var(--color-muted)] hover:text-[var(--color-primary)]" aria-label="상세">🔍</button>
                    <button type="button" onClick={() => alert(NOT_IMPLEMENTED)} className="text-[var(--color-muted)] hover:text-[var(--color-danger)]" aria-label="삭제">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaymentRequestPager page={page} totalPages={totalPages} filterParams={filterParams} />

      {rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
          {Object.values(filterValues).some((v) => v) ? "검색 결과가 없습니다." : "등록된 지급요청이 없습니다."}
        </p>
      )}
    </div>
  );
}
```

`_payees`/`_currentUserId`로 받는 이유: Task 10(상세보기 모달)이 이 파일을 다시 열어 실제로 사용하기 전까지, 아직 쓰지 않는 props를 미리 인터페이스에 확정해두기 위함(밑줄 접두사로 미사용 lint 경고 회피). Task 10에서 밑줄을 떼고 실제로 사용한다.

- [ ] **Step 3: 타입체크 + 린트**

Run: `npx tsc --noEmit && npx eslint src/app/\(app\)/expenses/page.tsx src/app/\(app\)/expenses/PaymentRequestListPanel.tsx`
Expected: 에러 없음.

- [ ] **Step 4: 수동 검증**

Run: `npm run dev`
- `/expenses?tab=payment-request` 접속 → 빈 목록 정상 렌더(공지 배너 빈 상태 포함).
- 필터 조합(고객사+지급여부 등) 조회 시 URL 쿼리 반영되고 재조회됨.
- PM 계정으로 로그인 시 엑셀다운로드 버튼 없음, "+ 등록"이 `/expenses/payment-request/new`로 이동(다음 태스크 전까지는 404 — 정상, Task 12에서 해소).
- ADMIN/SETTLEMENT 계정에서 "+ 등록"/"일괄수정"/"삭제"/"엑셀다운로드"/행의 🔍🗑️ 클릭 시 "추후 구현 예정입니다." 알림.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/page.tsx" "src/app/(app)/expenses/PaymentRequestListPanel.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 지급요청 목록 화면 연결

필터(지급일 기간/고객사/지급명의/지급여부/사업자명) + 페이지네이션은 실동작,
나머지 쓰기 액션 버튼은 안내 스텁으로 배치.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 9: `PaymentRequestRowsTable.tsx` (등록 행 편집기, 공용)

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestRowsTable.tsx`

**Interfaces:**
- Consumes: `PayeeCombobox`(Task 7), `TAX_TYPE_LABELS`/`TAX_TYPE_BY_LABEL`/`taxTypeLabel`(기존 `@/lib/labels`), `PAYMENT_REQUEST_ENTITY_LABELS`/`PAYMENT_REQUEST_ENTITY_BY_LABEL`/`paymentRequestEntityLabel`(Task 4).
- Produces:
  - `type DraftRow = { key: string; entity: "HUNO" | "HUNO_INC" | ""; clientId: string; payeeId: string | null; bizName: string; unitPrice: string; transportFee: string; materialFee: string; count: string; taxType: TaxType | ""; memo: string }`
  - `newDraftRow(): DraftRow`
  - `computeRowAmount(row: DraftRow): number`
  - `PaymentRequestRowsTable({ rows, onRowsChange, clients, payees }: { rows: DraftRow[]; onRowsChange: (rows: DraftRow[]) => void; clients: { id: string; name: string; businessType: string | null }[]; payees: PayeeOption[] })` — Task 12(등록 페이지)와 Task 13(등록 팝업)이 공용으로 사용.

- [ ] **Step 1: 구현**

```tsx
// src/app/(app)/expenses/PaymentRequestRowsTable.tsx
"use client";

import { useState } from "react";
import type { TaxType } from "@prisma/client";
import type { PayeeOption } from "@/lib/data/payees";
import { PayeeCombobox } from "@/components/PayeeCombobox";
import { TAX_TYPE_LABELS, TAX_TYPE_BY_LABEL, taxTypeLabel } from "@/lib/labels";
import { PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL } from "@/lib/labels";
import { formatWon } from "@/lib/format";

export type DraftRow = {
  key: string;
  entity: "HUNO" | "HUNO_INC" | "";
  clientId: string;
  payeeId: string | null;
  bizName: string;
  unitPrice: string;
  transportFee: string;
  materialFee: string;
  count: string;
  taxType: TaxType | "";
  memo: string;
};

export function newDraftRow(): DraftRow {
  return {
    key: crypto.randomUUID(),
    entity: "", clientId: "", payeeId: null, bizName: "",
    unitPrice: "", transportFee: "", materialFee: "", count: "",
    taxType: "", memo: "",
  };
}

export function computeRowAmount(row: DraftRow): number {
  const unitPrice = Number(row.unitPrice) || 0;
  const transportFee = Number(row.transportFee) || 0;
  const materialFee = Number(row.materialFee) || 0;
  const count = Number(row.count) || 0;
  return (unitPrice + transportFee + materialFee) * count;
}

// businessType("휴노"/"휴노INC")을 지급명의 enum으로. 그 외 값/미설정은 매핑하지 않는다.
function inferEntity(businessType: string | null): "HUNO" | "HUNO_INC" | "" {
  if (businessType === "휴노") return "HUNO";
  if (businessType === "휴노INC") return "HUNO_INC";
  return "";
}

const cellCls = "whitespace-nowrap px-2 py-2 text-center align-middle";
const inputCls = "w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-center text-sm";

export function PaymentRequestRowsTable({
  rows,
  onRowsChange,
  clients,
  payees,
}: {
  rows: DraftRow[];
  onRowsChange: (rows: DraftRow[]) => void;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
}) {
  // 체크박스 선택은 이 컴포넌트가 소유하는 실제 상태(useState)로 관리한다 — 렌더마다 새로
  // 만들어지는 일반 객체(ref 흉내)를 쓰면 다른 행 입력으로 리렌더될 때 선택이 조용히 사라진다.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function updateRow(key: string, patch: Partial<DraftRow>) {
    onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function handleClientChange(key: string, clientId: string) {
    const row = rows.find((r) => r.key === key)!;
    const client = clients.find((c) => c.id === clientId);
    const patch: Partial<DraftRow> = { clientId };
    // 지급명의를 아직 고르지 않았을 때만 고객사의 businessType으로 기본값을 채운다(덮어쓰지 않음).
    if (row.entity === "" && client) {
      const inferred = inferEntity(client.businessType);
      if (inferred) patch.entity = inferred;
    }
    updateRow(key, patch);
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function removeSelected() {
    if (selected.size === 0) return;
    onRowsChange(rows.filter((r) => !selected.has(r.key)));
    setSelected(new Set());
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-center text-[var(--color-muted)]">
              <th className="w-10 px-2 py-2">선택</th>
              <th className="w-10 px-2 py-2">No</th>
              <th className="px-2 py-2">지급명의</th>
              <th className="px-2 py-2">고객사</th>
              <th className="px-2 py-2">사업자명(이름)</th>
              <th className="px-2 py-2">단가</th>
              <th className="px-2 py-2">교통비</th>
              <th className="px-2 py-2">재료비</th>
              <th className="px-2 py-2">횟수</th>
              <th className="px-2 py-2">지급액(자동)</th>
              <th className="px-2 py-2">청구방식</th>
              <th className="px-2 py-2">상세내역</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <RowFields
                key={row.key}
                row={row}
                no={i + 1}
                selected={selected.has(row.key)}
                onToggleSelect={() => toggleSelect(row.key)}
                onChange={(patch) => updateRow(row.key, patch)}
                onClientChange={(clientId) => handleClientChange(row.key, clientId)}
                clients={clients}
                payees={payees}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => onRowsChange([...rows, newDraftRow()])} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">+ 행 추가</button>
        <button type="button" onClick={removeSelected} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">- 행 삭제</button>
      </div>
    </div>
  );
}

function RowFields({
  row, no, selected, onToggleSelect, onChange, onClientChange, clients, payees,
}: {
  row: DraftRow;
  no: number;
  selected: boolean;
  onToggleSelect: () => void;
  onChange: (patch: Partial<DraftRow>) => void;
  onClientChange: (clientId: string) => void;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
}) {
  return (
    <tr className="border-b border-[var(--color-border)]">
      <td className={cellCls}><input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`${no}행 선택`} /></td>
      <td className={cellCls}>{no}</td>
      <td className={cellCls}>
        <select value={row.entity} onChange={(e) => onChange({ entity: e.target.value as DraftRow["entity"] })} className={inputCls}>
          <option value="">선택</option>
          {PAYMENT_REQUEST_ENTITY_LABELS.map((label) => (
            <option key={label} value={PAYMENT_REQUEST_ENTITY_BY_LABEL[label]}>{label}</option>
          ))}
        </select>
      </td>
      <td className={cellCls}>
        <select value={row.clientId} onChange={(e) => onClientChange(e.target.value)} className={inputCls}>
          <option value="">선택</option>
          {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </td>
      <td className={`${cellCls} min-w-[10rem]`}>
        <PayeeCombobox
          payees={payees}
          selectedId={row.payeeId}
          onSelect={(p) => onChange({ payeeId: p?.id ?? null, bizName: p?.bizName ?? "" })}
        />
      </td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={row.unitPrice} onChange={(e) => onChange({ unitPrice: e.target.value.replace(/[^\d]/g, "") })} className={inputCls} /></td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={row.transportFee} onChange={(e) => onChange({ transportFee: e.target.value.replace(/[^\d]/g, "") })} className={inputCls} /></td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={row.materialFee} onChange={(e) => onChange({ materialFee: e.target.value.replace(/[^\d]/g, "") })} className={inputCls} /></td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={row.count} onChange={(e) => onChange({ count: e.target.value.replace(/[^\d]/g, "") })} className={inputCls} /></td>
      <td className={`${cellCls} font-medium`}>{formatWon(computeRowAmount(row))}</td>
      <td className={cellCls}>
        <select
          value={row.taxType ? taxTypeLabel(row.taxType) : ""}
          onChange={(e) => onChange({ taxType: e.target.value ? TAX_TYPE_BY_LABEL[e.target.value as (typeof TAX_TYPE_LABELS)[number]] : "" })}
          className={inputCls}
        >
          <option value="">선택</option>
          {TAX_TYPE_LABELS.map((label) => (<option key={label} value={label}>{label}</option>))}
        </select>
      </td>
      <td className={`${cellCls} min-w-[10rem]`}>
        <input type="text" value={row.memo} onChange={(e) => onChange({ memo: e.target.value })} placeholder="예: 7/30 테라리움 만들기 진행" className={inputCls} />
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestRowsTable.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 등록 행 편집기 컴포넌트 추가

행추가/행삭제, 사업자명 콤보박스 연동, 단가+교통비+재료비×횟수 자동계산.
등록 전체페이지(PM)와 등록 팝업(정산/관리자)이 공용으로 사용할 컴포넌트.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 10: `PaymentRequestDetailModal.tsx` (상세보기)

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestDetailModal.tsx`
- Modify: `src/app/(app)/expenses/PaymentRequestListPanel.tsx`

**Interfaces:**
- Consumes: `PaymentRequestRow`(Task 2), `taxTypeLabel`/`paymentRequestEntityLabel`/`paymentRequestStatusLabel`(기존+Task 4), `formatWon`.
- Produces: `PaymentRequestDetailModal({ row, role, currentUserId, onClose }: { row: PaymentRequestRow; role: AppRole; currentUserId: string; onClose: () => void })`. `PaymentRequestListPanel`이 "🔍 상세" 클릭 시 이 모달을 연다(이전 태스크의 알림 스텁을 대체).

- [ ] **Step 1: `PaymentRequestDetailModal.tsx` 구현**

```tsx
// src/app/(app)/expenses/PaymentRequestDetailModal.tsx
"use client";

import { useState } from "react";
import type { PaymentRequestRow } from "@/lib/data/payment-requests";
import type { AppRole } from "@/lib/auth/rbac";
import { taxTypeLabel, paymentRequestEntityLabel, paymentRequestStatusLabel } from "@/lib/labels";
import { formatWon } from "@/lib/format";

// PM은 지급완료 전 + 본인 신청 건에 한해 지급명의~상세내역을 수정할 수 있고,
// 정산담당자/관리자는 지급일/지급여부만 수정할 수 있다(그 외는 읽기전용).
// 실제 저장은 다음 단계에서 서버 액션을 연결한다 — 이번 단계는 화면만.
export function PaymentRequestDetailModal({
  row,
  role,
  currentUserId,
  onClose,
}: {
  row: PaymentRequestRow;
  role: AppRole;
  currentUserId: string;
  onClose: () => void;
}) {
  const canEditPmFields = role === "PM" && row.status === "PREPARING" && row.requesterId === currentUserId;
  const canEditSettlementFields = role === "ADMIN" || role === "SETTLEMENT";

  const [payDate, setPayDate] = useState(row.payDate ? row.payDate.toISOString().slice(0, 10) : "");
  const [status, setStatus] = useState(row.status);

  function handleSave() {
    alert("추후 구현 예정입니다.");
  }

  const fieldCls = "flex flex-col text-xs text-[var(--color-muted)]";
  const valueCls = "mt-1 text-sm text-[var(--color-fg)]";
  const inputCls = "mt-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">지급요청 상세</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className={fieldCls}>신청일<span className={valueCls}>{row.requestedAt.toISOString().slice(0, 10)}</span></div>
          <div className={fieldCls}>신청인<span className={valueCls}>{row.requesterName}</span></div>
          <div className={fieldCls}>지급명의<span className={valueCls}>{paymentRequestEntityLabel(row.entity)}</span></div>
          <div className={fieldCls}>고객사<span className={valueCls}>{row.clientName}</span></div>
          <div className={fieldCls}>사업자명(이름)<span className={valueCls}>{row.bizName}</span></div>
          <div className={fieldCls}>청구방식<span className={valueCls}>{taxTypeLabel(row.taxType)}</span></div>
          <div className={fieldCls}>단가<span className={valueCls}>{formatWon(row.unitPrice)}</span></div>
          <div className={fieldCls}>교통비<span className={valueCls}>{formatWon(row.transportFee)}</span></div>
          <div className={fieldCls}>재료비<span className={valueCls}>{formatWon(row.materialFee)}</span></div>
          <div className={fieldCls}>횟수<span className={valueCls}>{row.count}</span></div>
          <div className={fieldCls}>지급액<span className={valueCls}>{formatWon(row.amount)}</span></div>
          <div className="col-span-2 flex flex-col text-xs text-[var(--color-muted)]">상세내역(비고)<span className={valueCls}>{row.memo}</span></div>

          <label className={fieldCls}>
            지급일
            {canEditSettlementFields ? (
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputCls} />
            ) : (
              <span className={valueCls}>{row.payDate ? row.payDate.toISOString().slice(0, 10) : "-"}</span>
            )}
          </label>
          <label className={fieldCls}>
            지급여부
            {canEditSettlementFields ? (
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputCls}>
                <option value="PREPARING">지급준비</option>
                <option value="COMPLETED">지급완료</option>
              </select>
            ) : (
              <span className={valueCls}>{paymentRequestStatusLabel(row.status)}</span>
            )}
          </label>
        </div>

        {!canEditPmFields && !canEditSettlementFields && (
          <p className="mt-4 text-xs text-[var(--color-muted)]">지급완료된 건이거나 수정 권한이 없어 읽기전용으로 표시됩니다.</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">닫기</button>
          {(canEditPmFields || canEditSettlementFields) && (
            <button type="button" onClick={handleSave} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">저장</button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `PaymentRequestListPanel.tsx`에서 스텁을 실제 모달 연결로 교체**

`_payees`/`_currentUserId` props 이름에서 밑줄 제거(`payees`, `currentUserId`)하고, import 추가:

```typescript
import { PaymentRequestDetailModal } from "./PaymentRequestDetailModal";
```

컴포넌트 내부에 상태 추가(`const [selected, ...]` 다음 줄):

```typescript
const [detailTarget, setDetailTarget] = useState<PaymentRequestRow | null>(null);
```

행의 "🔍 상세" 버튼 `onClick={() => alert(NOT_IMPLEMENTED)}`를 아래로 교체:

```tsx
<button type="button" onClick={() => setDetailTarget(r)} className="text-[var(--color-muted)] hover:text-[var(--color-primary)]" aria-label="상세">🔍</button>
```

`</div>` (컴포넌트 최상위 반환의 마지막 닫는 태그) 바로 앞에 추가:

```tsx
{detailTarget && (
  <PaymentRequestDetailModal
    row={detailTarget}
    role={role}
    currentUserId={currentUserId}
    onClose={() => setDetailTarget(null)}
  />
)}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(미사용 props 경고도 사라짐).

- [ ] **Step 4: 수동 검증**

Run: `npm run dev` (Task 2에서 만든 테스트 DB가 아니라 실제 dev DB에 최소 1건을 수동으로 넣어야 상세보기를 눈으로 확인할 수 있다 — `npx prisma studio`로 `PaymentRequest` 테이블에 임시 행 하나를 직접 추가해서 확인해도 된다.)
- 목록에서 🔍 클릭 → 상세 모달이 뜨고 역할별로 편집 가능 필드가 다름(PM: 지급준비 상태 + 본인 건이면 상단 필드 입력 가능/정산: 지급일·지급여부만).
- "저장" 클릭 시 안내 알림.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestDetailModal.tsx" "src/app/(app)/expenses/PaymentRequestListPanel.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 상세보기 모달 연결

역할별 편집 가능 필드 구분(PM: 지급완료 전 본인 건의 입력 필드 전체 /
정산담당자·관리자: 지급일·지급여부만). 저장은 다음 단계에서 서버 액션 연결.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 11: `PaymentRequestBulkUpdateModal.tsx` (일괄수정 스텁)

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestBulkUpdateModal.tsx`
- Modify: `src/app/(app)/expenses/PaymentRequestListPanel.tsx`

**Interfaces:**
- Produces: `PaymentRequestBulkUpdateModal({ count, onClose }: { count: number; onClose: () => void })`. `PaymentRequestListPanel`의 "🗓️ 일괄수정" 버튼이 알림 스텁 대신 이 모달을 연다.

- [ ] **Step 1: 구현**

```tsx
// src/app/(app)/expenses/PaymentRequestBulkUpdateModal.tsx
"use client";

import { useState } from "react";

// 체크박스로 선택한 여러 건에 같은 지급일/지급여부를 한 번에 적용하는 팝업.
// 실제 일괄 반영 로직은 다음 단계에서 서버 액션을 연결한다 — 이번 단계는 화면만.
export function PaymentRequestBulkUpdateModal({ count, onClose }: { count: number; onClose: () => void }) {
  const [payDate, setPayDate] = useState("");
  const [status, setStatus] = useState<"PREPARING" | "COMPLETED">("COMPLETED");

  function handleApply() {
    alert("추후 구현 예정입니다.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">일괄수정</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">선택한 {count}건에 동일한 지급일/지급여부를 적용합니다.</p>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          지급일
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 rounded border border-[var(--color-border)] px-2 py-2 text-sm" />
        </label>
        <label className="mt-3 flex flex-col text-xs text-[var(--color-muted)]">
          지급여부
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="mt-1 rounded border border-[var(--color-border)] px-2 py-2 text-sm">
            <option value="PREPARING">지급준비</option>
            <option value="COMPLETED">지급완료</option>
          </select>
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
          <button type="button" onClick={handleApply} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">적용</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `PaymentRequestListPanel.tsx`에 연결**

import 추가: `import { PaymentRequestBulkUpdateModal } from "./PaymentRequestBulkUpdateModal";`

상태 추가(`detailTarget` 옆): `const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);`

"🗓️ 일괄수정" 버튼의 `onClick={() => alert(NOT_IMPLEMENTED)}`를 `onClick={() => setBulkUpdateOpen(true)}`로 교체.

모달 렌더 블록(`{detailTarget && (...)}` 다음)에 추가:

```tsx
{bulkUpdateOpen && (
  <PaymentRequestBulkUpdateModal count={selected.size} onClose={() => setBulkUpdateOpen(false)} />
)}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 수동 검증**

Run: `npm run dev` → 지급요청 목록에서 행 여러 개 체크 후 "🗓️ 일괄수정" 클릭 → 팝업에 선택 건수 표시, "적용" 클릭 시 안내.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestBulkUpdateModal.tsx" "src/app/(app)/expenses/PaymentRequestListPanel.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 일괄수정 팝업 연결(스텁)

체크박스로 선택한 건수 표시 + 지급일/지급여부 입력 UI. 실제 일괄 반영은
다음 단계에서 서버 액션 연결.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 12: PM 등록 전체 페이지

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestNewForm.tsx`
- Create: `src/app/(app)/expenses/payment-request/new/page.tsx`

**Interfaces:**
- Consumes: `PaymentRequestRowsTable`/`newDraftRow`(Task 9), `listClients`(기존), `listPayeeOptions`(Task 3), `requireUser`(기존).
- Produces: 라우트 `/expenses/payment-request/new`. `PaymentRequestNewForm({ clients, payees }: { clients: {...}[]; payees: PayeeOption[] })`.

- [ ] **Step 1: `PaymentRequestNewForm.tsx` 구현**

```tsx
// src/app/(app)/expenses/PaymentRequestNewForm.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { PayeeOption } from "@/lib/data/payees";
import { PaymentRequestRowsTable, newDraftRow, type DraftRow } from "./PaymentRequestRowsTable";

// PM 전용 지급요청 등록 화면. 행 추가/삭제·자동계산·엑셀 업로드 버튼은 이번 단계에서 완성하되,
// 실제 저장(서버 액션)은 다음 단계에서 연결한다 — "저장" 클릭은 안내만 띄운다.
export function PaymentRequestNewForm({
  clients,
  payees,
}: {
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
}) {
  const [rows, setRows] = useState<DraftRow[]>([newDraftRow()]);

  function handleSave() {
    alert("추후 구현 예정입니다.");
  }

  function handleExcelUpload() {
    alert("추후 구현 예정입니다.");
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">지급요청 등록</h1>
        <div className="flex gap-2">
          <button type="button" onClick={handleExcelUpload} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            엑셀 업로드(예외건)
          </button>
          <Link href="/expenses?tab=payment-request" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            취소
          </Link>
          <button type="button" onClick={handleSave} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">
            저장
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-[var(--color-muted)]">
        지급 리스트에 등록된 대상은 사업자명(이름)에서 검색해 선택하세요. 지급 리스트에 없는 예외 건은
        "엑셀 업로드(예외건)"로 등록합니다.
      </p>

      <PaymentRequestRowsTable rows={rows} onRowsChange={setRows} clients={clients} payees={payees} />
    </div>
  );
}
```

- [ ] **Step 2: 페이지 라우트 구현**

```tsx
// src/app/(app)/expenses/payment-request/new/page.tsx
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listPayeeOptions } from "@/lib/data/payees";
import { PaymentRequestNewForm } from "../../PaymentRequestNewForm";

export default async function NewPaymentRequestPage() {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const [clients, payees] = await Promise.all([listClients(ctx), listPayeeOptions(ctx)]);

  return (
    <div>
      <PaymentRequestNewForm
        clients={clients.map((c) => ({ id: c.id, name: c.name, businessType: c.businessType }))}
        payees={payees}
      />
    </div>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 수동 검증**

Run: `npm run dev`
- PM 계정으로 목록 화면 "+ 등록" 클릭 → `/expenses/payment-request/new` 진입.
- "+ 행 추가"로 행이 늘고, 체크 후 "- 행 삭제"로 줄어든다.
- 고객사 선택 시 `Client.businessType`이 "휴노"/"휴노INC"면 지급명의가 자동으로 채워지고, 이미 지급명의를 고른 뒤 고객사를 바꿔도 값이 유지된다(덮어쓰지 않음).
- 사업자명(이름) 입력창에 검색어를 치면 "이름 (고유번호)" 후보가 뜨고, 선택하면 입력창엔 이름만 남는다.
- 단가/교통비/재료비/횟수를 채우면 지급액이 자동 계산된다.
- "엑셀 업로드(예외건)"/"저장" 클릭 시 안내, "취소" 클릭 시 목록으로 이동.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestNewForm.tsx" "src/app/(app)/expenses/payment-request"
git commit -m "$(cat <<'EOF'
feat(payment-request): PM 등록 전체 페이지 추가

행추가/행삭제/자동계산/사업자명 검색은 실동작, 엑셀 업로드(예외건)와
저장은 다음 단계에서 서버 액션 연결.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## Task 13: 정산담당자/관리자 등록 팝업 + "+ 등록" 배선 마무리

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestRegisterModal.tsx`
- Modify: `src/app/(app)/expenses/PaymentRequestListPanel.tsx`
- Modify: `src/app/(app)/expenses/page.tsx`

**Interfaces:**
- Consumes: `PaymentRequestRowsTable`/`newDraftRow`(Task 9).
- Produces: `PaymentRequestRegisterModal({ clients, payees, onClose }: { clients: {...}[]; payees: PayeeOption[]; onClose: () => void })`. `PaymentRequestListPanel`의 "+ 등록"(ADMIN/SETTLEMENT 경로)이 알림 스텁 대신 이 모달을 연다.

- [ ] **Step 1: `PaymentRequestRegisterModal.tsx` 구현**

```tsx
// src/app/(app)/expenses/PaymentRequestRegisterModal.tsx
"use client";

import { useState } from "react";
import type { PayeeOption } from "@/lib/data/payees";
import { PaymentRequestRowsTable, newDraftRow, type DraftRow } from "./PaymentRequestRowsTable";

// 정산담당자/관리자용 등록 팝업. PM 전용 페이지(PaymentRequestNewForm)와 같은 행 편집기를
// 공유하되, 엑셀 업로드(예외건) 경로는 PM 전용이라 여기엔 없다. 저장은 다음 단계에서 연결.
export function PaymentRequestRegisterModal({
  clients,
  payees,
  onClose,
}: {
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([newDraftRow()]);

  function handleSave() {
    alert("추후 구현 예정입니다.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">지급요청 등록</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>

        <PaymentRequestRowsTable rows={rows} onRowsChange={setRows} clients={clients} payees={payees} />

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">취소</button>
          <button type="button" onClick={handleSave} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white">저장</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `PaymentRequestListPanel.tsx`에 clients/payees 전달 + 연결**

`payees`는 이미 Task 10에서 밑줄을 뗐으므로 그대로 사용 가능. import 추가:

```typescript
import { PaymentRequestRegisterModal } from "./PaymentRequestRegisterModal";
```

상태 추가: `const [registerOpen, setRegisterOpen] = useState(false);`

ADMIN/SETTLEMENT용 "+ 등록" 버튼의 `onClick={() => alert(NOT_IMPLEMENTED)}`를 `onClick={() => setRegisterOpen(true)}`로 교체.

모달 렌더 블록에 추가:

```tsx
{registerOpen && (
  <PaymentRequestRegisterModal clients={clients} payees={payees} onClose={() => setRegisterOpen(false)} />
)}
```

- [ ] **Step 3: `page.tsx`의 `PaymentRequestTab`이 넘기는 `clients` 배열에 `businessType` 포함 확인**

Task 8에서 이미 `clients.map((c) => ({ id: c.id, name: c.name, businessType: c.businessType }))` 형태로 넘기고 있으므로 추가 수정 불필요 — 타입만 다시 확인.

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: 수동 검증**

Run: `npm run dev`
- ADMIN/SETTLEMENT 계정으로 목록 화면 "+ 등록" 클릭 → 팝업에서 행추가/삭제/자동계산/사업자명 검색 동작, "저장" 클릭 시 안내, "취소"/배경 클릭 시 닫힘.
- PM 계정은 여전히 `/expenses/payment-request/new` 전체 페이지로 이동(변경 없음).

- [ ] **Step 6: 전체 테스트 스위트 + 최종 커밋**

Run: `npx vitest run`
Expected: 전체 PASS(회귀 없음).

```bash
git add "src/app/(app)/expenses/PaymentRequestRegisterModal.tsx" "src/app/(app)/expenses/PaymentRequestListPanel.tsx"
git commit -m "$(cat <<'EOF'
feat(payment-request): 정산담당자/관리자 등록 팝업 연결

PM 전용 페이지와 같은 행 편집기(PaymentRequestRowsTable)를 공유하되
엑셀 업로드(예외건) 경로는 제외. 저장은 다음 단계에서 서버 액션 연결.
지급요청 탭 UI 뼈대(조회 실동작 + 등록/수정/삭제/엑셀/공지 화면 스텁) 완료.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CMta6SMb8AZ117JaRX1Ap
EOF
)"
```

---

## 완료 조건 (스펙 대비 최종 점검)

- [ ] `/expenses?tab=payment-request` 진입 시 실제 DB 목록이 렌더링되고 5개 필터(지급일 기간/고객사/지급명의/지급여부/사업자명) 조합 조회가 동작한다.
- [ ] PM은 자신이 담당하는 고객사의 건만 보인다(RLS로 자동 제한, `PaymentRequestListPanel`에 role 분기 코드 없음).
- [ ] 목록 컬럼은 체크박스/No/신청일/신청인/지급명의/고객사/사업자명(이름)/지급액/지급일/지급여부/관리 11개로 고정되어 있다.
- [ ] PM "+ 등록"은 `/expenses/payment-request/new` 전체 페이지, ADMIN/SETTLEMENT "+ 등록"은 팝업으로 분기된다.
- [ ] 등록 화면에서 행추가/행삭제/자동계산/사업자명 검색(이름+고유번호 후보 → 이름만 표시)이 동작한다.
- [ ] 상세보기 모달이 역할별로 편집 가능 필드를 다르게 보여준다.
- [ ] 등록 저장/수정/삭제/엑셀 다운로드·업로드/공지사항 작성 버튼은 모두 존재하지만 클릭 시 안내만 뜬다.
- [ ] `npx vitest run` 전체 통과.
