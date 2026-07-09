# ROI 대시보드 Plan 2 — 수동 CRUD/입력 계층 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** @huno.kr 사용자가 역할에 맞는 셸에서 고객사·과업·단가를 설정하고 실적(횟수)·지출·청구·입금을 수동 입력하면, `withRLS`로 RLS가 강제된 채 안전하게 저장되는 입력 계층을 만든다.

**Architecture:** Plan 1 위에 3층을 얹는다 — (1) `src/lib/data/*` 데이터 계층(모든 쿼리를 `withRLS(ctx, tx => ...)` 안에서 실행), (2) 화면별 서버 액션(`requireRole`/`requireUser` 인가 → `zod` 검증 → 데이터 계층 호출), (3) `(app)` 라우트 그룹의 공통 셸 + 입력/설정 화면. 파생값 `amount = unitPrice × count`와 모든 불변식은 데이터 계층 한 곳에서 강제한다.

**Tech Stack:** Next.js 16(App Router), React 19, TypeScript 5, Tailwind CSS v4, Prisma 6, PostgreSQL 16, Vitest 4, zod(신규).

## Global Constraints

- **코드 저장소:** `C:\dev\roi-dashboard` (git, 브랜치 `master`). 계획/스펙 문서는 저장소 `docs/`에 커밋되며 구글 드라이브 사본은 별도 동기화(수동).
- **선행 설계:** `docs/superpowers/specs/2026-07-09-roi-dashboard-phase1-crud-design.md` (승인됨).
- **DB 접속 역할:** 앱·테스트 모두 비-슈퍼유저 `roi_app`(NOSUPERUSER, NOBYPASSRLS). 슈퍼유저는 RLS를 우회하므로 절대 사용 안 함.
- **로컬 테스트 PG:** 포터블 PostgreSQL을 **5433 포트**로 기동. 꺼져 있으면 먼저:
  `/c/dev/pgsql/bin/pg_ctl -D /c/dev/pgdata -o "-p 5433" -l /c/dev/pgdata/server.log start`
  `.env`/`.env.test`의 `DATABASE_URL`은 `roi_app@localhost:5433`.
- **역할 위계:** `ADMIN > SETTLEMENT > PM`. `requireRole("SETTLEMENT")`은 ADMIN도 통과(위계).
- **입력 권한:** 실적=PM(본인 담당)+상위, 지출/청구·입금/설정=ADMIN·SETTLEMENT, 사용자 관리=ADMIN(Plan 1).
- **금액:** 모든 금액은 `Int`(원 단위, 부가세 포함), **`≥ 0`**. `amount`는 **항상 서버가 `단가×횟수`로 재계산**해 저장(클라이언트 값 무시).
- **없음(null) vs 0:** 계약금·청구·입금은 입력칸을 비우면 "없음", `0`은 "0원". 실적 횟수 미입력 행은 저장하지 않는다(레코드 없음 = 미입력).
- **연/월 범위:** `year ∈ 2000..2100`, `month ∈ 1..12`.
- **모든 데이터 접근은 `withRLS` 경유.** RLS를 우회하는 쿼리 경로를 만들지 않는다(User 테이블 제외 — RLS 미적용).
- **자유 CRUD:** 승인 절차 없음. 입력 즉시 반영.
- **테스트:** Vitest. DB 테스트는 `roi_app`로 접속해야 RLS가 강제된다. 커밋은 논리 단위마다, Conventional Commits.

---

## File Structure

**신규 생성**
- `src/lib/action-state.ts` — 공용 액션 반환 타입.
- `src/lib/context.ts` — 세션 사용자 → `RlsContext` 변환(`getRlsContext`).
- `src/lib/validation/schemas.ts` — zod 입력 스키마(도메인별).
- `src/lib/data/clients.ts` — 고객사 조회/생성/수정.
- `src/lib/data/tasks.ts` — 과업 조회/생성/수정/삭제.
- `src/lib/data/performance.ts` — 실적 조회/일괄 upsert(금액 파생).
- `src/lib/data/expenses.ts` — 지출 조회/upsert.
- `src/lib/data/billing.ts` — 청구·입금 조회/upsert.
- `src/lib/shell/nav.ts` — 역할별 사이드바 메뉴(순수 함수).
- `src/components/shell/Sidebar.tsx`, `src/components/shell/Topbar.tsx` — 셸 UI.
- `src/app/(app)/layout.tsx` — 인증 셸 레이아웃.
- `src/app/(app)/clients/page.tsx` — 고객사 목록.
- `src/app/(app)/performance/{page.tsx,actions.ts,PerformanceGrid.tsx}` — 실적 입력.
- `src/app/(app)/expenses/{page.tsx,actions.ts,ExpenseForm.tsx}` — 지출 입력.
- `src/app/(app)/billing/{page.tsx,actions.ts,BillingForm.tsx}` — 청구·입금 입력.
- `src/app/(app)/settings/clients/{page.tsx,actions.ts}` — 고객사·과업 설정 목록.
- `src/app/(app)/settings/clients/[id]/page.tsx` — 고객사 상세 설정(과업 CRUD).
- 테스트: `test/data-clients.test.ts`, `test/data-tasks.test.ts`, `test/data-performance.test.ts`, `test/data-expenses.test.ts`, `test/data-billing.test.ts`, `test/context.test.ts`, `test/schemas.test.ts`, `test/nav.test.ts`.

**수정**
- `prisma/schema.prisma` — `Expense`에 `@@unique([clientId, year, month, category])` 추가(지출 분류 enum 13종은 커밋 안 된 WIP를 흡수).
- `src/lib/labels.ts` — 지출 분류 13종(WIP, 이미 워킹트리에 적용됨).
- `test/labels.test.ts` — 13종 기대로 갱신.
- `src/app/admin/users/page.tsx` — Plan 1 WIP(역할변경/비활성화 UX) 커밋.
- `src/app/page.tsx` — 활성 사용자를 `/clients`로 리다이렉트.

---

## Task 1: Plan 1 WIP 흡수 (지출 분류 13종 + 지출 유일 제약)

**Files:**
- Modify: `src/lib/labels.ts` (이미 워킹트리에 13종 반영됨 — 확인만)
- Modify: `test/labels.test.ts`
- Modify: `prisma/schema.prisma` (Expense에 유일 제약)
- Create: `prisma/migrations/<timestamp>_expense_unique_category/migration.sql` (prisma가 생성)
- Modify: `src/app/admin/users/page.tsx` (기존 WIP 커밋)

**Interfaces:**
- Consumes: Plan 1 스키마·라벨.
- Produces: `ExpenseCategory` 13종 enum, `Expense`의 `(clientId, year, month, category)` 유일 제약(`clientId_year_month_category`), 갱신된 `expenseCategoryLabel`. 후속 태스크는 이 13종과 유일 제약을 사용한다.

- [x] **Step 1: 현재 WIP 상태 확인**

```bash
cd /c/dev/roi-dashboard
git status --short
```
Expected: `M prisma/schema.prisma`, `M src/app/admin/users/page.tsx`, `M src/lib/labels.ts`, `?? prisma/migrations/20260709060000_update_expense_categories/`. (Plan 1에서 남은 미완 WIP.)

- [x] **Step 2: 라벨 테스트를 13종 기대로 갱신 (실패 확인용)**

Replace the `"maps expense categories to Korean"` test in `test/labels.test.ts` with:
```ts
  it("maps expense categories to Korean", () => {
    expect(expenseCategoryLabel("CORPORATE_CARD")).toBe("법인카드");
    expect(expenseCategoryLabel("PERSONAL_CARD")).toBe("개인카드");
    expect(expenseCategoryLabel("LABOR_COUNSELOR")).toBe("인건비(상담사)");
    expect(expenseCategoryLabel("LABOR_INSTRUCTOR")).toBe("인건비(강사)");
    expect(expenseCategoryLabel("EDUCATION_PROGRAM")).toBe("교육&프로그램 진행비");
    expect(expenseCategoryLabel("PROMOTION_OFFLINE")).toBe("홍보비(오프라인)");
    expect(expenseCategoryLabel("PROMOTION_EVENT")).toBe("홍보비(이벤트)");
    expect(expenseCategoryLabel("OPS_TRANSPORT")).toBe("운영비(교통비)");
    expect(expenseCategoryLabel("OPS_LODGING")).toBe("운영비(숙박비)");
    expect(expenseCategoryLabel("OPS_FOOD")).toBe("운영비(식비)");
    expect(expenseCategoryLabel("OPS_MEETING")).toBe("운영비(회의비)");
    expect(expenseCategoryLabel("TEST_MATERIAL")).toBe("검사지 구매");
    expect(expenseCategoryLabel("GENERAL_ETC")).toBe("일반관리(기타)");
  });
```

- [x] **Step 3: 라벨 테스트 실행 → 통과 확인**

`labels.ts`는 워킹트리에 이미 13종이 적용돼 있으므로 갱신된 테스트가 바로 통과한다.
```bash
npm run test -- labels
```
Expected: PASS. (혹시 `labels.ts`가 6종이면 이 파일을 13종으로 먼저 갱신 — Design §8 표 참조.)

- [x] **Step 4: Expense 유일 제약을 스키마에 추가**

`prisma/schema.prisma`의 `model Expense`에서 인덱스 줄을 유일 제약 + 인덱스로 바꾼다. 기존:
```prisma
  @@index([clientId, year, month])
```
을 다음으로 교체:
```prisma
  @@unique([clientId, year, month, category])
  @@index([clientId, year, month])
```

- [x] **Step 5: 마이그레이션 생성·적용**

```bash
npx prisma migrate dev --name expense_unique_category
```
Expected: 대기 중이던 `20260709060000_update_expense_categories`(enum 13종)와 신규 `expense_unique_category`가 함께 적용되고, `prisma/migrations/<timestamp>_expense_unique_category/migration.sql`에 `CREATE UNIQUE INDEX "Expense_clientId_year_month_category_key" ...`가 생성된다.

- [x] **Step 6: 전체 테스트 + 빌드 확인**

```bash
npm run test
npm run build
```
Expected: 모든 테스트 PASS, 빌드 성공.

- [x] **Step 7: 커밋 (지출 분류 모델)**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/labels.ts test/labels.test.ts
git commit -m "feat: expand expense categories to 13 types and enforce per-category uniqueness"
```

- [x] **Step 8: 관리자 화면 WIP 커밋 (별도)**

`src/app/admin/users/page.tsx`의 UX 변경(활성 사용자는 역할변경/비활성화 분리)은 Plan 1에서 진행되던 개선이다. 별도로 커밋:
```bash
git add src/app/admin/users/page.tsx
git commit -m "refactor: separate role-change and deactivate actions in admin users page"
```

- [x] **Step 9: 워킹트리 정리 확인**

```bash
git status --short
```
Expected: 출력 없음(clean). 이제 Plan 2를 깨끗한 baseline에서 시작.

---

## Task 2: 공용 스캐폴딩 (action-state, getRlsContext, zod 설치)

**Files:**
- Create: `src/lib/action-state.ts`, `src/lib/context.ts`, `test/context.test.ts`
- Modify: `package.json` (zod 의존성)

**Interfaces:**
- Consumes: `RlsContext` (`@/lib/rls`), `AppRole`/`SessionUser` (Plan 1).
- Produces:
  - `type ActionState = { ok: boolean; error?: string }`, `const OK: ActionState = { ok: true }`.
  - `getRlsContext(user: { id: string; role: AppRole | null }): RlsContext` — 역할이 `null`이면 throw(승인된 사용자는 항상 역할 보유). 후속 액션은 이 함수로 세션→ctx 변환.

- [x] **Step 1: zod 설치**

```bash
npm install zod
```

- [x] **Step 2: 공용 액션 반환 타입 작성**

Create `src/lib/action-state.ts`:
```ts
export type ActionState = { ok: boolean; error?: string };
export const OK: ActionState = { ok: true };
```

- [x] **Step 3: context 테스트 작성 (실패 확인용)**

Create `test/context.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getRlsContext } from "@/lib/context";

describe("getRlsContext", () => {
  it("maps an approved user to an RLS context", () => {
    expect(getRlsContext({ id: "u1", role: "PM" })).toEqual({ userId: "u1", role: "PM" });
    expect(getRlsContext({ id: "u2", role: "ADMIN" })).toEqual({ userId: "u2", role: "ADMIN" });
  });
  it("throws when role is null (unapproved user should never reach data layer)", () => {
    expect(() => getRlsContext({ id: "u3", role: null })).toThrow(/역할/);
  });
});
```

- [x] **Step 4: 테스트 실행 → 실패 확인**

```bash
npm run test -- context
```
Expected: FAIL — 모듈 없음.

- [x] **Step 5: getRlsContext 구현**

Create `src/lib/context.ts`:
```ts
import type { RlsContext } from "@/lib/rls";
import type { AppRole } from "@/lib/auth/rbac";

/** 세션 사용자 → RLS 컨텍스트. 승인된 사용자는 항상 역할을 가진다. */
export function getRlsContext(user: { id: string; role: AppRole | null }): RlsContext {
  if (!user.role) throw new Error("역할이 지정되지 않은 사용자입니다.");
  return { userId: user.id, role: user.role };
}
```

- [x] **Step 6: 테스트 실행 → 통과 확인**

```bash
npm run test -- context
```
Expected: PASS.

- [x] **Step 7: 커밋**

```bash
git add package.json package-lock.json src/lib/action-state.ts src/lib/context.ts test/context.test.ts
git commit -m "feat: add zod, action-state type, and getRlsContext helper"
```

---

## Task 3: zod 입력 스키마

**Files:**
- Create: `src/lib/validation/schemas.ts`, `test/schemas.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces (모두 `safeParse` 가능한 zod 스키마):
  - `clientSchema` → `{ name; status?; contractStart?: Date|null; contractEnd?: Date|null; pmId?: string|null }`
  - `taskSchema` → `{ clientId; name; unitPrice: number; contractAmount?: number|null }`
  - `performanceBatchSchema` → `{ clientId; year; month; rows: { taskId; count }[] }`
  - `expenseSchema` → `{ clientId; year; month; category; amount; memo?: string|null }`
  - `billingSchema`, `depositSchema` → `{ clientId; year; month; amount: number|null }`
  - 상수 `EXPENSE_CATEGORIES: readonly [...13종]`.

- [x] **Step 1: 스키마 테스트 작성 (실패 확인용)**

Create `test/schemas.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  performanceBatchSchema,
  expenseSchema,
  billingSchema,
  taskSchema,
} from "@/lib/validation/schemas";

describe("performanceBatchSchema", () => {
  it("accepts a valid batch", () => {
    const r = performanceBatchSchema.safeParse({
      clientId: "c1", year: "2026", month: "3", rows: [{ taskId: "t1", count: "4" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rows[0].count).toBe(4);
  });
  it("rejects negative count", () => {
    const r = performanceBatchSchema.safeParse({
      clientId: "c1", year: 2026, month: 3, rows: [{ taskId: "t1", count: -1 }],
    });
    expect(r.success).toBe(false);
  });
  it("rejects month out of range", () => {
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2026, month: 13, rows: [] }).success).toBe(false);
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2026, month: 0, rows: [] }).success).toBe(false);
  });
  it("rejects non-integer count", () => {
    expect(performanceBatchSchema.safeParse({ clientId: "c1", year: 2026, month: 3, rows: [{ taskId: "t1", count: 1.5 }] }).success).toBe(false);
  });
});

describe("expenseSchema", () => {
  it("accepts a valid expense with memo", () => {
    const r = expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: 5000, memo: "회식" });
    expect(r.success).toBe(true);
  });
  it("rejects unknown category", () => {
    expect(expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "NOPE", amount: 1 }).success).toBe(false);
  });
  it("rejects negative amount", () => {
    expect(expenseSchema.safeParse({ clientId: "c1", year: 2026, month: 3, category: "OPS_FOOD", amount: -1 }).success).toBe(false);
  });
});

describe("billingSchema (null vs 0)", () => {
  it("treats empty string as null (미입력)", () => {
    const r = billingSchema.safeParse({ clientId: "c1", year: 2026, month: 3, amount: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBeNull();
  });
  it("keeps 0 as 0 (0원)", () => {
    const r = billingSchema.safeParse({ clientId: "c1", year: 2026, month: 3, amount: "0" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(0);
  });
  it("rejects negative amount", () => {
    expect(billingSchema.safeParse({ clientId: "c1", year: 2026, month: 3, amount: -5 }).success).toBe(false);
  });
});

describe("taskSchema", () => {
  it("accepts a task with null contractAmount", () => {
    const r = taskSchema.safeParse({ clientId: "c1", name: "심리진단", unitPrice: 10000, contractAmount: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contractAmount).toBeNull();
  });
  it("rejects empty name", () => {
    expect(taskSchema.safeParse({ clientId: "c1", name: "", unitPrice: 100 }).success).toBe(false);
  });
});
```

- [x] **Step 2: 테스트 실행 → 실패 확인**

```bash
npm run test -- schemas
```
Expected: FAIL — 모듈 없음.

- [x] **Step 3: 스키마 구현**

Create `src/lib/validation/schemas.ts`:
```ts
import { z } from "zod";

export const EXPENSE_CATEGORIES = [
  "CORPORATE_CARD", "PERSONAL_CARD", "LABOR_COUNSELOR", "LABOR_INSTRUCTOR",
  "EDUCATION_PROGRAM", "PROMOTION_OFFLINE", "PROMOTION_EVENT", "OPS_TRANSPORT",
  "OPS_LODGING", "OPS_FOOD", "OPS_MEETING", "TEST_MATERIAL", "GENERAL_ETC",
] as const;

const year = z.coerce.number().int().min(2000).max(2100);
const month = z.coerce.number().int().min(1).max(12);
const nonNegInt = z.coerce.number().int().min(0);

// 빈 문자열/undefined → null, 그 외엔 정수(≥0). "없음(null) vs 0" 구분용.
const nullableAmount = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : v),
  z.coerce.number().int().min(0).nullable(),
);

export const clientSchema = z.object({
  name: z.string().min(1),
  status: z.string().optional(),
  contractStart: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
  contractEnd: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
  pmId: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
});

export const taskSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  unitPrice: nonNegInt,
  contractAmount: nullableAmount,
});

export const performanceBatchSchema = z.object({
  clientId: z.string().min(1),
  year,
  month,
  rows: z.array(z.object({ taskId: z.string().min(1), count: nonNegInt })),
});

export const expenseSchema = z.object({
  clientId: z.string().min(1),
  year,
  month,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: nonNegInt,
  memo: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
});

export const billingSchema = z.object({ clientId: z.string().min(1), year, month, amount: nullableAmount });
export const depositSchema = billingSchema;
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

```bash
npm run test -- schemas
```
Expected: PASS.

- [x] **Step 5: 커밋**

```bash
git add src/lib/validation/schemas.ts test/schemas.test.ts
git commit -m "feat: add zod input schemas for clients, tasks, performance, expenses, billing"
```

---

## Task 4: 데이터 계층 — 고객사(clients)

**Files:**
- Create: `src/lib/data/clients.ts`, `test/data-clients.test.ts`

**Interfaces:**
- Consumes: `withRLS`, `RlsContext` (`@/lib/rls`), `ActionState` (`@/lib/action-state`).
- Produces:
  - `listClients(ctx): Promise<Client[]>` (이름 오름차순)
  - `getClient(ctx, id): Promise<Client | null>`
  - `createClient(ctx, input): Promise<Client>`
  - `updateClient(ctx, id, input): Promise<ActionState>`
  - `type ClientInput = { name: string; status?: string; contractStart?: Date|null; contractEnd?: Date|null; pmId?: string|null }`

- [x] **Step 1: 테스트 작성 (실패 확인용)**

Create `test/data-clients.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { listClients, createClient, updateClient } from "@/lib/data/clients";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("clients data layer", () => {
  let pmA: string, pmB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
  });

  it("ADMIN creates and lists clients", async () => {
    await createClient(ADMIN, { name: "A사", pmId: pmA });
    await createClient(ADMIN, { name: "B사", pmId: pmB });
    const rows = await listClients(ADMIN);
    expect(rows.map((r) => r.name)).toEqual(["A사", "B사"]);
  });

  it("PM sees only own client (RLS)", async () => {
    await createClient(ADMIN, { name: "A사", pmId: pmA });
    await createClient(ADMIN, { name: "B사", pmId: pmB });
    const rows = await listClients({ userId: pmA, role: "PM" });
    expect(rows.map((r) => r.name)).toEqual(["A사"]);
  });

  it("PM cannot update another PM's client (RLS → ok:false)", async () => {
    const b = await createClient(ADMIN, { name: "B사", pmId: pmB });
    const res = await updateClient({ userId: pmA, role: "PM" }, b.id, { name: "해킹", pmId: pmB });
    expect(res.ok).toBe(false);
    const still = await withRLS(ADMIN, (tx) => tx.client.findUnique({ where: { id: b.id } }));
    expect(still?.name).toBe("B사");
  });
});
```

- [x] **Step 2: 테스트 실행 → 실패 확인**

```bash
npm run test -- data-clients
```
Expected: FAIL — 모듈 없음.

- [x] **Step 3: 구현**

Create `src/lib/data/clients.ts`:
```ts
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type ClientInput = {
  name: string;
  status?: string;
  contractStart?: Date | null;
  contractEnd?: Date | null;
  pmId?: string | null;
};

export function listClients(ctx: RlsContext) {
  return withRLS(ctx, (tx) => tx.client.findMany({ orderBy: { name: "asc" } }));
}

export function getClient(ctx: RlsContext, id: string) {
  return withRLS(ctx, (tx) => tx.client.findUnique({ where: { id } }));
}

export function createClient(ctx: RlsContext, input: ClientInput) {
  return withRLS(ctx, (tx) =>
    tx.client.create({
      data: {
        name: input.name,
        status: input.status ?? "진행중",
        contractStart: input.contractStart ?? null,
        contractEnd: input.contractEnd ?? null,
        pmId: input.pmId ?? null,
      },
    }),
  );
}

export async function updateClient(ctx: RlsContext, id: string, input: ClientInput): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.client.updateMany({
      where: { id },
      data: {
        name: input.name,
        status: input.status,
        contractStart: input.contractStart ?? null,
        contractEnd: input.contractEnd ?? null,
        pmId: input.pmId ?? null,
      },
    }),
  );
  if (result.count === 0) return { ok: false, error: "고객사를 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

```bash
npm run test -- data-clients
```
Expected: PASS.

- [x] **Step 5: 커밋**

```bash
git add src/lib/data/clients.ts test/data-clients.test.ts
git commit -m "feat: add clients data layer with RLS-enforced CRUD"
```

---

## Task 5: 데이터 계층 — 과업(tasks)

**Files:**
- Create: `src/lib/data/tasks.ts`, `test/data-tasks.test.ts`

**Interfaces:**
- Consumes: `withRLS`, `RlsContext`, `ActionState`.
- Produces:
  - `listTasks(ctx, clientId): Promise<Task[]>` (이름 오름차순)
  - `createTask(ctx, input): Promise<Task>` — `input: { clientId; name; unitPrice; contractAmount?: number|null }`, `source`는 기본 `MANUAL`.
  - `updateTask(ctx, id, input): Promise<ActionState>`
  - `deleteTask(ctx, id): Promise<ActionState>`
  - `type TaskInput = { clientId: string; name: string; unitPrice: number; contractAmount?: number | null }`

- [x] **Step 1: 테스트 작성 (실패 확인용)**

Create `test/data-tasks.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { listTasks, createTask, updateTask, deleteTask } from "@/lib/data/tasks";
import { createClient } from "@/lib/data/clients";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.monthlyPerformance.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("tasks data layer", () => {
  let pmA: string, pmB: string, clientA: string, clientB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
  });

  it("creates a task with MANUAL source and nullable contractAmount", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000, contractAmount: null });
    expect(t.source).toBe("MANUAL");
    expect(t.contractAmount).toBeNull();
    const rows = await listTasks(ADMIN, clientA);
    expect(rows.map((r) => r.name)).toEqual(["심리진단"]);
  });

  it("PM lists only own client's tasks (RLS)", async () => {
    await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000 });
    await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000 });
    const rows = await listTasks({ userId: pmA, role: "PM" }, clientA);
    expect(rows.map((r) => r.name)).toEqual(["심리진단"]);
  });

  it("PM cannot delete a task under another PM's client (RLS → ok:false)", async () => {
    const t = await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000 });
    const res = await deleteTask({ userId: pmA, role: "PM" }, t.id);
    expect(res.ok).toBe(false);
    const still = await withRLS(ADMIN, (tx) => tx.task.findUnique({ where: { id: t.id } }));
    expect(still).not.toBeNull();
  });

  it("updates a task's unit price", async () => {
    const t = await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000 });
    const res = await updateTask(ADMIN, t.id, { clientId: clientA, name: "심리진단", unitPrice: 12000 });
    expect(res.ok).toBe(true);
    const rows = await listTasks(ADMIN, clientA);
    expect(rows[0].unitPrice).toBe(12000);
  });
});
```

- [x] **Step 2: 테스트 실행 → 실패 확인**

```bash
npm run test -- data-tasks
```
Expected: FAIL — 모듈 없음.

- [x] **Step 3: 구현**

Create `src/lib/data/tasks.ts`:
```ts
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type TaskInput = {
  clientId: string;
  name: string;
  unitPrice: number;
  contractAmount?: number | null;
};

export function listTasks(ctx: RlsContext, clientId: string) {
  return withRLS(ctx, (tx) => tx.task.findMany({ where: { clientId }, orderBy: { name: "asc" } }));
}

export function createTask(ctx: RlsContext, input: TaskInput) {
  return withRLS(ctx, (tx) =>
    tx.task.create({
      data: {
        clientId: input.clientId,
        name: input.name,
        unitPrice: input.unitPrice,
        contractAmount: input.contractAmount ?? null,
      },
    }),
  );
}

export async function updateTask(ctx: RlsContext, id: string, input: TaskInput): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) =>
    tx.task.updateMany({
      where: { id },
      data: { name: input.name, unitPrice: input.unitPrice, contractAmount: input.contractAmount ?? null },
    }),
  );
  if (result.count === 0) return { ok: false, error: "과업을 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}

export async function deleteTask(ctx: RlsContext, id: string): Promise<ActionState> {
  const result = await withRLS(ctx, (tx) => tx.task.deleteMany({ where: { id } }));
  if (result.count === 0) return { ok: false, error: "과업을 찾을 수 없거나 권한이 없습니다." };
  return { ok: true };
}
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

```bash
npm run test -- data-tasks
```
Expected: PASS.

- [x] **Step 5: 커밋**

```bash
git add src/lib/data/tasks.ts test/data-tasks.test.ts
git commit -m "feat: add tasks data layer with RLS-enforced CRUD"
```

---

## Task 6: 데이터 계층 — 실적(performance, 금액 파생 핵심)

**Files:**
- Create: `src/lib/data/performance.ts`, `test/data-performance.test.ts`

**Interfaces:**
- Consumes: `withRLS`, `RlsContext`, `ActionState`.
- Produces:
  - `listPerformance(ctx, clientId, year, month): Promise<MonthlyPerformance[]>`
  - `upsertPerformanceBatch(ctx, input): Promise<ActionState>` — `input: { clientId; year; month; rows: { taskId; count }[] }`. 각 행 `amount = task.unitPrice × count` **서버 재계산**, `@@unique([taskId,year,month])` 기준 upsert, 단일 트랜잭션. 과업이 없거나 `clientId` 불일치(=RLS 은닉 포함) 시 전체 롤백 후 `{ ok:false }`.
  - `type PerformanceBatchInput = { clientId: string; year: number; month: number; rows: { taskId: string; count: number }[] }`

- [x] **Step 1: 테스트 작성 (실패 확인용)**

Create `test/data-performance.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { upsertPerformanceBatch, listPerformance } from "@/lib/data/performance";
import { createClient } from "@/lib/data/clients";
import { createTask } from "@/lib/data/tasks";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.monthlyPerformance.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("performance data layer", () => {
  let pmA: string, pmB: string, clientA: string, taskA1: string, clientB: string, taskB1: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    taskA1 = (await createTask(ADMIN, { clientId: clientA, name: "심리진단", unitPrice: 10000 })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
    taskB1 = (await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000 })).id;
  });

  it("computes amount = unitPrice * count on save", async () => {
    const res = await upsertPerformanceBatch({ userId: pmA, role: "PM" }, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 4 }] });
    expect(res.ok).toBe(true);
    const rows = await listPerformance(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(40000);
    expect(rows[0].count).toBe(4);
  });

  it("upsert is idempotent on (task, year, month)", async () => {
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 4 }] });
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA1, count: 7 }] });
    const rows = await listPerformance(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(7);
    expect(rows[0].amount).toBe(70000);
  });

  it("PM A cannot write performance to PM B's task (RLS → ok:false, no row)", async () => {
    const res = await upsertPerformanceBatch({ userId: pmA, role: "PM" }, { clientId: clientB, year: 2026, month: 3, rows: [{ taskId: taskB1, count: 1 }] });
    expect(res.ok).toBe(false);
    const rows = await listPerformance(ADMIN, clientB, 2026, 3);
    expect(rows).toHaveLength(0);
  });

  it("rejects a row whose task belongs to a different client", async () => {
    const res = await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskB1, count: 1 }] });
    expect(res.ok).toBe(false);
  });
});
```

- [x] **Step 2: 테스트 실행 → 실패 확인**

```bash
npm run test -- data-performance
```
Expected: FAIL — 모듈 없음.

- [x] **Step 3: 구현**

Create `src/lib/data/performance.ts`:
```ts
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type PerformanceBatchInput = {
  clientId: string;
  year: number;
  month: number;
  rows: { taskId: string; count: number }[];
};

export function listPerformance(ctx: RlsContext, clientId: string, year: number, month: number) {
  return withRLS(ctx, (tx) =>
    tx.monthlyPerformance.findMany({ where: { year, month, task: { clientId } } }),
  );
}

const FORBIDDEN = "FORBIDDEN_OR_MISSING_TASK";

export function upsertPerformanceBatch(ctx: RlsContext, input: PerformanceBatchInput): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    for (const row of input.rows) {
      const task = await tx.task.findUnique({ where: { id: row.taskId } });
      // task가 null이면: 존재하지 않거나 RLS가 은닉(타 고객사) → 위조로 간주하고 전체 롤백.
      if (!task || task.clientId !== input.clientId) throw new Error(FORBIDDEN);
      const amount = task.unitPrice * row.count;
      await tx.monthlyPerformance.upsert({
        where: { taskId_year_month: { taskId: row.taskId, year: input.year, month: input.month } },
        create: { taskId: row.taskId, year: input.year, month: input.month, count: row.count, amount },
        update: { count: row.count, amount },
      });
    }
    return { ok: true } as ActionState;
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === FORBIDDEN) {
      return { ok: false, error: "과업을 찾을 수 없거나 권한이 없습니다." };
    }
    throw e;
  });
}
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

```bash
npm run test -- data-performance
```
Expected: PASS (4 passed).

- [x] **Step 5: 커밋**

```bash
git add src/lib/data/performance.ts test/data-performance.test.ts
git commit -m "feat: add performance data layer with server-side amount derivation and RLS"
```

---

## Task 7: 데이터 계층 — 지출(expenses)

**Files:**
- Create: `src/lib/data/expenses.ts`, `test/data-expenses.test.ts`

**Interfaces:**
- Consumes: `withRLS`, `RlsContext`, `ActionState`, `ExpenseCategory` (`@prisma/client`).
- Produces:
  - `listExpenses(ctx, clientId, year, month): Promise<Expense[]>`
  - `upsertExpense(ctx, input): Promise<ActionState>` — `input: { clientId; year; month; category; amount; memo?: string|null }`, `@@unique([clientId,year,month,category])` 기준 upsert.
  - `type ExpenseInput = { clientId: string; year: number; month: number; category: ExpenseCategory; amount: number; memo?: string | null }`

- [x] **Step 1: 테스트 작성 (실패 확인용)**

Create `test/data-expenses.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { upsertExpense, listExpenses } from "@/lib/data/expenses";
import { createClient } from "@/lib/data/clients";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.expense.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("expenses data layer", () => {
  let pmA: string, pmB: string, clientA: string, clientB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
  });

  it("upserts one row per category and updates in place", async () => {
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000, memo: "회식" });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 7000, memo: "정정" });
    const rows = await listExpenses(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(7000);
    expect(rows[0].memo).toBe("정정");
  });

  it("keeps different categories as separate rows", async () => {
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_TRANSPORT", amount: 3000 });
    const rows = await listExpenses(ADMIN, clientA, 2026, 3);
    expect(rows).toHaveLength(2);
  });

  it("PM A cannot read/write PM B's expenses (RLS)", async () => {
    await upsertExpense(ADMIN, { clientId: clientB, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    const rowsForA = await listExpenses({ userId: pmA, role: "PM" }, clientB, 2026, 3);
    expect(rowsForA).toHaveLength(0);
  });
});
```

- [x] **Step 2: 테스트 실행 → 실패 확인**

```bash
npm run test -- data-expenses
```
Expected: FAIL — 모듈 없음.

- [x] **Step 3: 구현**

Create `src/lib/data/expenses.ts`:
```ts
import type { ExpenseCategory } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type ExpenseInput = {
  clientId: string;
  year: number;
  month: number;
  category: ExpenseCategory;
  amount: number;
  memo?: string | null;
};

export function listExpenses(ctx: RlsContext, clientId: string, year: number, month: number) {
  return withRLS(ctx, (tx) => tx.expense.findMany({ where: { clientId, year, month } }));
}

export async function upsertExpense(ctx: RlsContext, input: ExpenseInput): Promise<ActionState> {
  await withRLS(ctx, (tx) =>
    tx.expense.upsert({
      where: {
        clientId_year_month_category: {
          clientId: input.clientId,
          year: input.year,
          month: input.month,
          category: input.category,
        },
      },
      create: {
        clientId: input.clientId,
        year: input.year,
        month: input.month,
        category: input.category,
        amount: input.amount,
        memo: input.memo ?? null,
      },
      update: { amount: input.amount, memo: input.memo ?? null },
    }),
  );
  return { ok: true };
}
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

```bash
npm run test -- data-expenses
```
Expected: PASS.

- [x] **Step 5: 커밋**

```bash
git add src/lib/data/expenses.ts test/data-expenses.test.ts
git commit -m "feat: add expenses data layer with per-category upsert and RLS"
```

---

## Task 8: 데이터 계층 — 청구·입금(billing & deposits)

**Files:**
- Create: `src/lib/data/billing.ts`, `test/data-billing.test.ts`

**Interfaces:**
- Consumes: `withRLS`, `RlsContext`, `ActionState`.
- Produces (청구/입금 대칭):
  - `getBilling(ctx, clientId, year, month): Promise<MonthlyBilling | null>`
  - `upsertBilling(ctx, input): Promise<ActionState>` — `input: { clientId; year; month; amount: number|null }`. `amount === null` → 해당 월 행 삭제(미입력), 아니면 `@@unique([clientId,year,month])` upsert.
  - `getDeposit(ctx, ...)`, `upsertDeposit(ctx, input)` — 동일 형태.
  - `type AmountInput = { clientId: string; year: number; month: number; amount: number | null }`

- [x] **Step 1: 테스트 작성 (실패 확인용)**

Create `test/data-billing.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { upsertBilling, getBilling, upsertDeposit, getDeposit } from "@/lib/data/billing";
import { createClient } from "@/lib/data/clients";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.monthlyBilling.deleteMany();
    await tx.monthlyDeposit.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("billing/deposit data layer", () => {
  let pmA: string, pmB: string, clientA: string, clientB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
  });

  it("stores 0 as 0 (0원)", async () => {
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 0 });
    const row = await getBilling(ADMIN, clientA, 2026, 3);
    expect(row?.amount).toBe(0);
  });

  it("null amount removes the row (미입력)", async () => {
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 5000 });
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: null });
    const row = await getBilling(ADMIN, clientA, 2026, 3);
    expect(row).toBeNull();
  });

  it("upsert updates in place", async () => {
    await upsertDeposit(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 1000 });
    await upsertDeposit(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 2000 });
    const row = await getDeposit(ADMIN, clientA, 2026, 3);
    expect(row?.amount).toBe(2000);
  });

  it("PM A cannot read PM B's billing (RLS)", async () => {
    await upsertBilling(ADMIN, { clientId: clientB, year: 2026, month: 3, amount: 9000 });
    const row = await getBilling({ userId: pmA, role: "PM" }, clientB, 2026, 3);
    expect(row).toBeNull();
  });
});
```

- [x] **Step 2: 테스트 실행 → 실패 확인**

```bash
npm run test -- data-billing
```
Expected: FAIL — 모듈 없음.

- [x] **Step 3: 구현**

Create `src/lib/data/billing.ts`:
```ts
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

export type AmountInput = { clientId: string; year: number; month: number; amount: number | null };

export function getBilling(ctx: RlsContext, clientId: string, year: number, month: number) {
  return withRLS(ctx, (tx) =>
    tx.monthlyBilling.findUnique({ where: { clientId_year_month: { clientId, year, month } } }),
  );
}

export async function upsertBilling(ctx: RlsContext, input: AmountInput): Promise<ActionState> {
  await withRLS(ctx, async (tx) => {
    if (input.amount === null) {
      await tx.monthlyBilling.deleteMany({ where: { clientId: input.clientId, year: input.year, month: input.month } });
      return;
    }
    await tx.monthlyBilling.upsert({
      where: { clientId_year_month: { clientId: input.clientId, year: input.year, month: input.month } },
      create: { clientId: input.clientId, year: input.year, month: input.month, amount: input.amount },
      update: { amount: input.amount },
    });
  });
  return { ok: true };
}

export function getDeposit(ctx: RlsContext, clientId: string, year: number, month: number) {
  return withRLS(ctx, (tx) =>
    tx.monthlyDeposit.findUnique({ where: { clientId_year_month: { clientId, year, month } } }),
  );
}

export async function upsertDeposit(ctx: RlsContext, input: AmountInput): Promise<ActionState> {
  await withRLS(ctx, async (tx) => {
    if (input.amount === null) {
      await tx.monthlyDeposit.deleteMany({ where: { clientId: input.clientId, year: input.year, month: input.month } });
      return;
    }
    await tx.monthlyDeposit.upsert({
      where: { clientId_year_month: { clientId: input.clientId, year: input.year, month: input.month } },
      create: { clientId: input.clientId, year: input.year, month: input.month, amount: input.amount },
      update: { amount: input.amount },
    });
  });
  return { ok: true };
}
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

```bash
npm run test -- data-billing
```
Expected: PASS.

- [x] **Step 5: 커밋**

```bash
git add src/lib/data/billing.ts test/data-billing.test.ts
git commit -m "feat: add billing/deposit data layer with null-vs-zero semantics and RLS"
```

---

## Task 9: 공통 셸 (역할별 사이드바 + 상단바 + 레이아웃)

**Files:**
- Create: `src/lib/shell/nav.ts`, `test/nav.test.ts`
- Create: `src/components/shell/Sidebar.tsx`, `src/components/shell/Topbar.tsx`
- Create: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `AppRole` (`@/lib/auth/rbac`), `requireUser` (`@/lib/auth/session`), `roleLabel` (`@/lib/labels`), `signOut` (`@/lib/auth`).
- Produces:
  - `navItemsForRole(role: AppRole | null): { href: string; label: string }[]`
  - `(app)` 그룹 레이아웃: 좌측 사이드바 + 상단바 + 본문. `requireUser` 가드.

- [x] **Step 1: nav 테스트 작성 (실패 확인용)**

Create `test/nav.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { navItemsForRole } from "@/lib/shell/nav";

const hrefs = (role: Parameters<typeof navItemsForRole>[0]) => navItemsForRole(role).map((i) => i.href);

describe("navItemsForRole", () => {
  it("PM sees clients and performance only", () => {
    expect(hrefs("PM")).toEqual(["/clients", "/performance"]);
  });
  it("SETTLEMENT adds expenses, billing, settings", () => {
    expect(hrefs("SETTLEMENT")).toEqual(["/clients", "/performance", "/expenses", "/billing", "/settings/clients"]);
  });
  it("ADMIN adds user management", () => {
    expect(hrefs("ADMIN")).toEqual(["/clients", "/performance", "/expenses", "/billing", "/settings/clients", "/admin/users"]);
  });
  it("null role sees base items only", () => {
    expect(hrefs(null)).toEqual(["/clients", "/performance"]);
  });
});
```

- [x] **Step 2: 테스트 실행 → 실패 확인**

```bash
npm run test -- nav
```
Expected: FAIL — 모듈 없음.

- [x] **Step 3: nav 구현**

Create `src/lib/shell/nav.ts`:
```ts
import type { AppRole } from "@/lib/auth/rbac";

export type NavItem = { href: string; label: string };

export function navItemsForRole(role: AppRole | null): NavItem[] {
  const items: NavItem[] = [
    { href: "/clients", label: "고객사 목록" },
    { href: "/performance", label: "실적 입력" },
  ];
  if (role === "SETTLEMENT" || role === "ADMIN") {
    items.push({ href: "/expenses", label: "지출 입력" });
    items.push({ href: "/billing", label: "청구·입금 입력" });
    items.push({ href: "/settings/clients", label: "설정" });
  }
  if (role === "ADMIN") items.push({ href: "/admin/users", label: "사용자 관리" });
  return items;
}
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

```bash
npm run test -- nav
```
Expected: PASS.

- [x] **Step 5: 사이드바·상단바 컴포넌트 작성**

Create `src/components/shell/Sidebar.tsx`:
```tsx
import Link from "next/link";
import { navItemsForRole } from "@/lib/shell/nav";
import type { AppRole } from "@/lib/auth/rbac";

export function Sidebar({ role }: { role: AppRole | null }) {
  const items = navItemsForRole(role);
  return (
    <aside className="w-56 shrink-0 bg-[var(--color-sidebar)] p-4 text-white">
      <div className="mb-6 px-2 text-lg font-semibold">ROI 대시보드</div>
      <nav className="flex flex-col gap-1">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="rounded px-2 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">
            {i.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

Create `src/components/shell/Topbar.tsx`:
```tsx
import { signOut } from "@/lib/auth";
import { roleLabel } from "@/lib/labels";
import type { AppRole } from "@/lib/auth/rbac";

export function Topbar({ email, role }: { email: string; role: AppRole | null }) {
  return (
    <header className="flex items-center justify-end gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3">
      <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-muted)]">
        {roleLabel(role)}
      </span>
      <span className="text-sm text-[var(--color-fg)]">{email}</span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1 text-xs">
          로그아웃
        </button>
      </form>
    </header>
  );
}
```

- [x] **Step 6: (app) 레이아웃 작성**

Create `src/app/(app)/layout.tsx`:
```tsx
import { requireUser } from "@/lib/auth/session";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar role={user.role} />
      <div className="flex flex-1 flex-col">
        <Topbar email={user.email ?? ""} role={user.role} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
```

- [x] **Step 7: 빌드 확인 및 커밋**

```bash
npm run build
```
Expected: 성공. (아직 `(app)` 하위 페이지가 없어도 레이아웃만으로 빌드된다.)
```bash
git add src/lib/shell/nav.ts test/nav.test.ts src/components/shell src/app/\(app\)/layout.tsx
git commit -m "feat: add app shell layout with role-based sidebar and topbar"
```

---

## Task 10: 고객사·과업·단가 설정 화면

**Files:**
- Create: `src/app/(app)/settings/clients/page.tsx`, `src/app/(app)/settings/clients/actions.ts`
- Create: `src/app/(app)/settings/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireRole` (SETTLEMENT), `getRlsContext`, `listClients`/`createClient`/`updateClient`/`getClient` (clients), `listTasks`/`createTask`/`updateTask`/`deleteTask` (tasks), `clientSchema`/`taskSchema`, `prisma`(활성 PM 목록 — User는 RLS 미적용), `roleLabel`.
- Produces: 설정 목록/상세 화면과 폼 서버 액션들(`createClientAction`, `updateClientAction`, `createTaskAction`, `updateTaskAction`, `deleteTaskAction`). 모두 `requireRole("SETTLEMENT")`로 시작.

- [x] **Step 1: 설정 액션 작성**

Create `src/app/(app)/settings/clients/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { clientSchema, taskSchema } from "@/lib/validation/schemas";
import { createClient, updateClient } from "@/lib/data/clients";
import { createTask, updateTask, deleteTask } from "@/lib/data/tasks";

export async function createClientAction(formData: FormData): Promise<void> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    pmId: formData.get("pmId"),
  });
  if (parsed.success) await createClient(ctx, parsed.data);
  revalidatePath("/settings/clients");
}

export async function updateClientAction(formData: FormData): Promise<void> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    pmId: formData.get("pmId"),
  });
  if (parsed.success) await updateClient(ctx, id, parsed.data);
  revalidatePath(`/settings/clients/${id}`);
}

export async function createTaskAction(formData: FormData): Promise<void> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = taskSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    unitPrice: formData.get("unitPrice"),
    contractAmount: formData.get("contractAmount"),
  });
  if (parsed.success) await createTask(ctx, parsed.data);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
}

export async function updateTaskAction(formData: FormData): Promise<void> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const parsed = taskSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    unitPrice: formData.get("unitPrice"),
    contractAmount: formData.get("contractAmount"),
  });
  if (parsed.success) await updateTask(ctx, id, parsed.data);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  await deleteTask(ctx, id);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
}
```

- [x] **Step 2: 설정 목록 페이지 작성**

Create `src/app/(app)/settings/clients/page.tsx`:
```tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { prisma } from "@/lib/db";
import { createClientAction } from "./actions";

export default async function SettingsClientsPage() {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const [clients, pms] = await Promise.all([
    listClients(ctx),
    prisma.user.findMany({ where: { role: "PM", status: "ACTIVE" }, orderBy: { email: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">고객사·과업 설정</h1>

      <form action={createClientAction} className="mb-6 flex flex-wrap items-end gap-2 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사명
          <input name="name" required className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          담당 PM
          <select name="pmId" defaultValue="" className="rounded border border-[var(--color-border)] px-2 py-1 text-sm">
            <option value="">미지정</option>
            {pms.map((p) => (
              <option key={p.id} value={p.id}>{p.email}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          계약 시작
          <input type="date" name="contractStart" className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          계약 종료
          <input type="date" name="contractEnd" className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white">고객사 추가</button>
      </form>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">고객사</th>
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="border-b border-[var(--color-border)]">
              <td className="py-2">{c.name}</td>
              <td>{c.status}</td>
              <td>
                <Link href={`/settings/clients/${c.id}`} className="text-[var(--color-primary)]">과업·단가 설정</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [x] **Step 3: 설정 상세(과업 CRUD) 페이지 작성**

Create `src/app/(app)/settings/clients/[id]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { getClient } from "@/lib/data/clients";
import { listTasks } from "@/lib/data/tasks";
import { createTaskAction, updateTaskAction, deleteTaskAction } from "../actions";

export default async function SettingsClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const client = await getClient(ctx, id);
  if (!client) notFound();
  const tasks = await listTasks(ctx, id);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{client.name} — 과업·단가</h1>

      <form action={createTaskAction} className="mb-6 flex flex-wrap items-end gap-2 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <input type="hidden" name="clientId" value={id} />
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          과업명
          <input name="name" required className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          단가(원)
          <input type="number" name="unitPrice" min="0" required className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          계약금(원, 없으면 비움)
          <input type="number" name="contractAmount" min="0" className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white">과업 추가</button>
      </form>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">과업</th>
            <th>단가</th>
            <th>계약금</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-b border-[var(--color-border)]">
              <td className="py-2">
                <form action={updateTaskAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="clientId" value={id} />
                  <input name="name" defaultValue={t.name} className="rounded border border-[var(--color-border)] px-2 py-1" />
                  <input type="number" name="unitPrice" min="0" defaultValue={t.unitPrice} className="w-24 rounded border border-[var(--color-border)] px-2 py-1" />
                  <input type="number" name="contractAmount" min="0" defaultValue={t.contractAmount ?? ""} className="w-28 rounded border border-[var(--color-border)] px-2 py-1" />
                  <button type="submit" className="rounded bg-[var(--color-primary)] px-2 py-1 text-white">저장</button>
                </form>
              </td>
              <td>{t.unitPrice.toLocaleString()}</td>
              <td>{t.contractAmount == null ? "—" : t.contractAmount.toLocaleString()}</td>
              <td>
                <form action={deleteTaskAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="clientId" value={id} />
                  <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1">삭제</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [x] **Step 4: 빌드 확인 및 커밋**

```bash
npm run build
```
Expected: 성공.
```bash
git add src/app/\(app\)/settings
git commit -m "feat: add client and task settings screens (SETTLEMENT+)"
```

---

## Task 11: 고객사 목록 화면

**Files:**
- Create: `src/app/(app)/clients/page.tsx`

**Interfaces:**
- Consumes: `requireUser`, `getRlsContext`, `listClients`.
- Produces: 활성 사용자용 고객사 목록(PM은 RLS로 본인 담당만). 각 고객사에서 실적 입력으로 이동.

- [x] **Step 1: 목록 페이지 작성**

Create `src/app/(app)/clients/page.tsx`:
```tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";

export default async function ClientsPage() {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">고객사 목록</h1>
      {clients.length === 0 ? (
        <p className="text-[var(--color-muted)]">담당 고객사가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/performance?clientId=${c.id}`}
              className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm hover:border-[var(--color-primary)]"
            >
              <div className="text-base font-medium text-[var(--color-fg)]">{c.name}</div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">{c.status}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 2: 빌드 확인 및 커밋**

```bash
npm run build
```
Expected: 성공.
```bash
git add src/app/\(app\)/clients
git commit -m "feat: add client list screen (RLS-scoped for PM)"
```

---

## Task 12: 실적 입력 화면

**Files:**
- Create: `src/app/(app)/performance/page.tsx`, `src/app/(app)/performance/actions.ts`, `src/app/(app)/performance/PerformanceGrid.tsx`

**Interfaces:**
- Consumes: `requireUser`, `getRlsContext`, `listClients`, `listTasks`, `listPerformance`, `upsertPerformanceBatch`, `performanceBatchSchema`, `ActionState`/`OK`.
- Produces:
  - `savePerformance(prev: ActionState, formData: FormData): Promise<ActionState>` — 폼의 `count_<taskId>` 필드를 모아 배치 upsert. 빈 값은 미입력으로 제외.
  - 고객사+연월 선택 → 과업별 횟수 입력 그리드(금액·합계 실시간).

- [x] **Step 1: 실적 액션 작성**

Create `src/app/(app)/performance/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { performanceBatchSchema } from "@/lib/validation/schemas";
import { upsertPerformanceBatch } from "@/lib/data/performance";
import type { ActionState } from "@/lib/action-state";

export async function savePerformance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const ctx = getRlsContext(user);

  const rows: { taskId: string; count: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("count_")) {
      const raw = String(value).trim();
      if (raw === "") continue; // 미입력 → 저장 안 함
      rows.push({ taskId: key.slice("count_".length), count: raw });
    }
  }

  const parsed = performanceBatchSchema.safeParse({
    clientId: formData.get("clientId"),
    year: formData.get("year"),
    month: formData.get("month"),
    rows,
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 횟수는 0 이상의 정수여야 합니다." };

  const result = await upsertPerformanceBatch(ctx, parsed.data);
  if (result.ok) revalidatePath("/performance");
  return result;
}
```

- [x] **Step 2: 실적 그리드(클라이언트 컴포넌트) 작성**

Create `src/app/(app)/performance/PerformanceGrid.tsx`:
```tsx
"use client";

import { useActionState, useState } from "react";
import { savePerformance } from "./actions";
import { OK } from "@/lib/action-state";

type Task = { id: string; name: string; unitPrice: number };

export function PerformanceGrid({
  clientId, year, month, tasks, initialCounts,
}: {
  clientId: string; year: number; month: number;
  tasks: Task[]; initialCounts: Record<string, number>;
}) {
  const [state, formAction] = useActionState(savePerformance, OK);
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(tasks.map((t) => [t.id, initialCounts[t.id]?.toString() ?? ""])),
  );

  const total = tasks.reduce((sum, t) => {
    const n = Number(counts[t.id]);
    return sum + (Number.isFinite(n) ? t.unitPrice * n : 0);
  }, 0);

  return (
    <form action={formAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />

      {!state.ok && state.error && (
        <p className="mb-3 rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">{state.error}</p>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">과업</th>
            <th>단가</th>
            <th>횟수</th>
            <th>금액</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const n = Number(counts[t.id]);
            const amount = Number.isFinite(n) ? t.unitPrice * n : 0;
            return (
              <tr key={t.id} className="border-b border-[var(--color-border)]">
                <td className="py-2">{t.name}</td>
                <td>{t.unitPrice.toLocaleString()}</td>
                <td>
                  <input
                    type="number" min="0" name={`count_${t.id}`} value={counts[t.id]}
                    onChange={(e) => setCounts((c) => ({ ...c, [t.id]: e.target.value }))}
                    className="w-24 rounded border border-[var(--color-border)] px-2 py-1"
                  />
                </td>
                <td>{amount.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <td className="py-2" colSpan={3}>합계</td>
            <td>{total.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>

      <button type="submit" className="mt-4 rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
    </form>
  );
}
```

- [x] **Step 3: 실적 페이지 작성 (고객사+연월 선택 → 그리드)**

Create `src/app/(app)/performance/page.tsx`:
```tsx
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listTasks } from "@/lib/data/tasks";
import { listPerformance } from "@/lib/data/performance";
import { PerformanceGrid } from "./PerformanceGrid";

const now = { year: 2026, month: 1 }; // 기본 연월(전역 기간 필터는 Plan 3). 사용자가 선택기로 변경.

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId ?? clients[0]?.id;
  const year = Number(sp.year) || now.year;
  const month = Number(sp.month) || now.month;

  const [tasks, perf] = clientId
    ? await Promise.all([listTasks(ctx, clientId), listPerformance(ctx, clientId, year, month)])
    : [[], []];
  const initialCounts = Object.fromEntries(perf.map((p) => [p.taskId, p.count]));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">실적 입력</h1>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <select name="clientId" defaultValue={clientId ?? ""} className="rounded border border-[var(--color-border)] px-2 py-1 text-sm">
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          연도
          <input type="number" name="year" defaultValue={year} className="w-24 rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          월
          <input type="number" name="month" min="1" max="12" defaultValue={month} className="w-20 rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">조회</button>
      </form>

      {!clientId ? (
        <p className="text-[var(--color-muted)]">담당 고객사가 없습니다.</p>
      ) : tasks.length === 0 ? (
        <p className="text-[var(--color-muted)]">등록된 과업이 없습니다. 설정에서 과업을 먼저 등록하세요.</p>
      ) : (
        <PerformanceGrid
          clientId={clientId}
          year={year}
          month={month}
          tasks={tasks.map((t) => ({ id: t.id, name: t.name, unitPrice: t.unitPrice }))}
          initialCounts={initialCounts}
        />
      )}
    </div>
  );
}
```

- [x] **Step 4: 빌드 확인 및 커밋**

```bash
npm run build
```
Expected: 성공.
```bash
git add src/app/\(app\)/performance
git commit -m "feat: add performance input screen with per-task count grid"
```

---

## Task 13: 지출 입력 화면

**Files:**
- Create: `src/app/(app)/expenses/page.tsx`, `src/app/(app)/expenses/actions.ts`, `src/app/(app)/expenses/ExpenseForm.tsx`

**Interfaces:**
- Consumes: `requireRole` (SETTLEMENT), `getRlsContext`, `listClients`, `listExpenses`, `upsertExpense`, `expenseSchema`, `EXPENSE_CATEGORIES`, `expenseCategoryLabel`, `ActionState`/`OK`.
- Produces:
  - `saveExpense(prev: ActionState, formData: FormData): Promise<ActionState>` — 단일 분류 upsert.
  - 고객사+연월 선택 → 13종 분류별 금액·메모 입력.

- [x] **Step 1: 지출 액션 작성**

Create `src/app/(app)/expenses/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { expenseSchema } from "@/lib/validation/schemas";
import { upsertExpense } from "@/lib/data/expenses";
import type { ActionState } from "@/lib/action-state";

export async function saveExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = expenseSchema.safeParse({
    clientId: formData.get("clientId"),
    year: formData.get("year"),
    month: formData.get("month"),
    category: formData.get("category"),
    amount: formData.get("amount"),
    memo: formData.get("memo"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 금액은 0 이상의 정수여야 합니다." };
  const result = await upsertExpense(ctx, parsed.data);
  if (result.ok) revalidatePath("/expenses");
  return result;
}
```

- [x] **Step 2: 지출 폼(클라이언트 컴포넌트) 작성**

Create `src/app/(app)/expenses/ExpenseForm.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { saveExpense } from "./actions";
import { OK } from "@/lib/action-state";
import { expenseCategoryLabel } from "@/lib/labels";
import { EXPENSE_CATEGORIES } from "@/lib/validation/schemas";

type Row = { category: (typeof EXPENSE_CATEGORIES)[number]; amount: number | ""; memo: string };

export function ExpenseForm({
  clientId, year, month, rows,
}: {
  clientId: string; year: number; month: number; rows: Row[];
}) {
  const [state, formAction] = useActionState(saveExpense, OK);
  return (
    <div>
      {!state.ok && state.error && (
        <p className="mb-3 rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">{state.error}</p>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">분류</th>
            <th>금액</th>
            <th>메모</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category} className="border-b border-[var(--color-border)]">
              <td className="py-2">{expenseCategoryLabel(r.category)}</td>
              <td colSpan={3}>
                <form action={formAction} className="flex items-center gap-2">
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="year" value={year} />
                  <input type="hidden" name="month" value={month} />
                  <input type="hidden" name="category" value={r.category} />
                  <input type="number" min="0" name="amount" defaultValue={r.amount} className="w-32 rounded border border-[var(--color-border)] px-2 py-1" />
                  <input name="memo" defaultValue={r.memo} placeholder="메모" className="flex-1 rounded border border-[var(--color-border)] px-2 py-1" />
                  <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1 text-white">저장</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [x] **Step 3: 지출 페이지 작성**

Create `src/app/(app)/expenses/page.tsx`:
```tsx
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listExpenses } from "@/lib/data/expenses";
import { EXPENSE_CATEGORIES } from "@/lib/validation/schemas";
import { ExpenseForm } from "./ExpenseForm";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId ?? clients[0]?.id;
  const year = Number(sp.year) || 2026;
  const month = Number(sp.month) || 1;

  const existing = clientId ? await listExpenses(ctx, clientId, year, month) : [];
  const byCat = new Map(existing.map((e) => [e.category, e]));
  const rows = EXPENSE_CATEGORIES.map((category) => ({
    category,
    amount: (byCat.get(category)?.amount ?? "") as number | "",
    memo: byCat.get(category)?.memo ?? "",
  }));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">지출 입력</h1>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <select name="clientId" defaultValue={clientId ?? ""} className="rounded border border-[var(--color-border)] px-2 py-1 text-sm">
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          연도
          <input type="number" name="year" defaultValue={year} className="w-24 rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          월
          <input type="number" name="month" min="1" max="12" defaultValue={month} className="w-20 rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">조회</button>
      </form>

      {!clientId ? (
        <p className="text-[var(--color-muted)]">고객사가 없습니다.</p>
      ) : (
        <ExpenseForm clientId={clientId} year={year} month={month} rows={rows} />
      )}
    </div>
  );
}
```

- [x] **Step 4: 빌드 확인 및 커밋**

```bash
npm run build
```
Expected: 성공.
```bash
git add src/app/\(app\)/expenses
git commit -m "feat: add expense input screen with 13 categories (SETTLEMENT+)"
```

---

## Task 14: 청구·입금 입력 화면

**Files:**
- Create: `src/app/(app)/billing/page.tsx`, `src/app/(app)/billing/actions.ts`, `src/app/(app)/billing/BillingForm.tsx`

**Interfaces:**
- Consumes: `requireRole` (SETTLEMENT), `getRlsContext`, `listClients`, `getBilling`/`getDeposit`/`upsertBilling`/`upsertDeposit`, `billingSchema`/`depositSchema`, `ActionState`/`OK`.
- Produces:
  - `saveBilling(prev, formData)`, `saveDeposit(prev, formData)` — 각 값 upsert(빈 값 → null → 행 삭제).
  - 고객사+연월 선택 → 청구액·입금액 입력.

- [ ] **Step 1: 청구·입금 액션 작성**

Create `src/app/(app)/billing/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { billingSchema, depositSchema } from "@/lib/validation/schemas";
import { upsertBilling, upsertDeposit } from "@/lib/data/billing";
import type { ActionState } from "@/lib/action-state";

export async function saveBilling(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = billingSchema.safeParse({
    clientId: formData.get("clientId"),
    year: formData.get("year"),
    month: formData.get("month"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) return { ok: false, error: "청구액은 0 이상의 정수여야 합니다." };
  const result = await upsertBilling(ctx, parsed.data);
  if (result.ok) revalidatePath("/billing");
  return result;
}

export async function saveDeposit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = depositSchema.safeParse({
    clientId: formData.get("clientId"),
    year: formData.get("year"),
    month: formData.get("month"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) return { ok: false, error: "입금액은 0 이상의 정수여야 합니다." };
  const result = await upsertDeposit(ctx, parsed.data);
  if (result.ok) revalidatePath("/billing");
  return result;
}
```

- [ ] **Step 2: 청구·입금 폼(클라이언트 컴포넌트) 작성**

Create `src/app/(app)/billing/BillingForm.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { saveBilling, saveDeposit } from "./actions";
import { OK } from "@/lib/action-state";

function AmountForm({
  label, clientId, year, month, defaultValue, action,
}: {
  label: string; clientId: string; year: number; month: number;
  defaultValue: number | ""; action: typeof saveBilling;
}) {
  const [state, formAction] = useActionState(action, OK);
  return (
    <form action={formAction} className="mb-3 flex items-end gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        {label}(비우면 미입력)
        <input type="number" min="0" name="amount" defaultValue={defaultValue} className="w-40 rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white">저장</button>
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
    </form>
  );
}

export function BillingForm({
  clientId, year, month, billing, deposit,
}: {
  clientId: string; year: number; month: number;
  billing: number | ""; deposit: number | "";
}) {
  return (
    <div>
      <AmountForm label="청구액" clientId={clientId} year={year} month={month} defaultValue={billing} action={saveBilling} />
      <AmountForm label="입금액" clientId={clientId} year={year} month={month} defaultValue={deposit} action={saveDeposit} />
    </div>
  );
}
```

- [ ] **Step 3: 청구·입금 페이지 작성**

Create `src/app/(app)/billing/page.tsx`:
```tsx
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { getBilling, getDeposit } from "@/lib/data/billing";
import { BillingForm } from "./BillingForm";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  const clientId = sp.clientId ?? clients[0]?.id;
  const year = Number(sp.year) || 2026;
  const month = Number(sp.month) || 1;

  const [billing, deposit] = clientId
    ? await Promise.all([getBilling(ctx, clientId, year, month), getDeposit(ctx, clientId, year, month)])
    : [null, null];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">청구·입금 입력</h1>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          고객사
          <select name="clientId" defaultValue={clientId ?? ""} className="rounded border border-[var(--color-border)] px-2 py-1 text-sm">
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          연도
          <input type="number" name="year" defaultValue={year} className="w-24 rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          월
          <input type="number" name="month" min="1" max="12" defaultValue={month} className="w-20 rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">조회</button>
      </form>

      {!clientId ? (
        <p className="text-[var(--color-muted)]">고객사가 없습니다.</p>
      ) : (
        <BillingForm
          clientId={clientId}
          year={year}
          month={month}
          billing={(billing?.amount ?? "") as number | ""}
          deposit={(deposit?.amount ?? "") as number | ""}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 빌드 확인 및 커밋**

```bash
npm run build
```
Expected: 성공.
```bash
git add src/app/\(app\)/billing
git commit -m "feat: add billing/deposit input screen (SETTLEMENT+)"
```

---

## Task 15: 랜딩 리다이렉트 + 최종 검증

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `requireUser`.
- Produces: 활성 사용자가 `/`로 오면 `/clients`로 리다이렉트(전사 대시보드는 Plan 3에서 대체).

- [ ] **Step 1: 루트 페이지를 리다이렉트로 교체**

Replace `src/app/page.tsx` with:
```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

export default async function HomePage() {
  await requireUser(); // 미인증/미승인은 여기서 리다이렉트
  redirect("/clients");
}
```

- [ ] **Step 2: 전체 테스트 실행**

로컬 PG(5433)가 켜져 있어야 한다. 꺼져 있으면 Global Constraints의 기동 명령을 먼저 실행.
```bash
npm run test
```
Expected: 모든 테스트 PASS (labels, context, schemas, nav, data-clients, data-tasks, data-performance, data-expenses, data-billing + Plan 1 테스트).

- [ ] **Step 3: 빌드 확인**

```bash
npm run build
```
Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/app/page.tsx
git commit -m "feat: redirect authenticated root to client list"
```

- [ ] **Step 5: (선택) 수동 확인**

`npm run dev` 후 @huno.kr 로그인 → 역할별 사이드바 확인 → 설정에서 고객사·과업 등록 → 실적/지출/청구·입금 입력 → 값이 유지되는지 확인. PM 계정으로는 본인 담당 고객사만 보이는지 확인.

---

## Self-Review 결과

**Spec coverage (설계 문서 대비):**
- §3 데이터 계층(withRLS 경유, 인가 진입점, zod, 파생·불변식) → Task 2·3·4~8, 각 화면 액션(10·12·13·14).
- §4 화면/셸(역할별 메뉴, 상단바, 라우트, 랜딩) → Task 9·10·11·12·13·14·15.
- §5 파생·검증(amount 재계산, null vs 0, 월/연 범위, 지출 유일 제약) → Task 1·3·6·8.
- §6 인가·에러(이중 방어, {ok,error}, RLS 최종 차단) → Task 4~8 데이터 계층 + 각 액션 requireRole/requireUser.
- §7 테스트(데이터 계층 RLS 격리, 스키마, nav) → Task 3·4·5·6·7·8·9.
- §8 지출 13종 WIP 흡수 → Task 1.
- §2 정책(자유 CRUD, 정액 과업=단가×1) → 승인 절차 없음(액션에 상태 필드 없음), 정액은 별도 처리 불필요(단가×횟수 모델 그대로).

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. TBD/TODO 없음.

**Type consistency:** `RlsContext{userId,role}`, `ActionState{ok,error?}`, `getRlsContext`, 데이터 함수 시그니처, 복합 유일키(`taskId_year_month`, `clientId_year_month`, `clientId_year_month_category`)가 스키마와 데이터 계층·액션에서 일관. useActionState 액션 시그니처 `(prev, formData) => Promise<ActionState>` 일관.

**보류/후속(Plan 3):** 고객사 상세, 전사 집계 지표, 전역 기간/고객사 필터, 대시보드 본문. 실적 페이지의 기본 연월은 하드코딩(2026-1)이며 Plan 3의 전역 기간 필터로 대체 예정 — 코드 주석에 명시.
