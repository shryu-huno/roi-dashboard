# ROI 대시보드 Plan 3 — 수익률 대시보드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** @huno.kr 사용자가 역할에 맞는 대시보드에서 집계 KPI(수익률·달성률·청구율·수금률), 수익 흐름 깔때기, 월별 추이, 지출 구성을 보고 고객사 상세로 드릴다운·CSV 내보내기하며, PM은 RLS로 본인 담당만 집계되는 조회 계층을 완성한다.

**Architecture:** Plan 2의 3층 패턴(순수 함수 + `withRLS` 데이터 계층 + 화면)을 확장한다. `src/lib/period.ts`·`src/lib/metrics/formulas.ts`(순수, DB 무), `src/lib/data/metrics.ts`(Prisma `aggregate`/`groupBy`를 `withRLS`로 감싼 집계), `src/components/charts/*`(정적 SVG/CSS 프레젠테이션, RSC), `(app)/dashboard`·`(app)/clients/[id]` 화면. RLS가 PM 범위를 물리적으로 강제하므로 대시보드 코드에 역할 분기를 두지 않는다.

**Tech Stack:** Next.js 16(App Router), React 19, TypeScript 5, Tailwind CSS v4, Prisma 6, PostgreSQL 16, Vitest 4. **신규 런타임 의존성 없음.**

## Global Constraints

- **코드 저장소:** `C:\dev\roi-dashboard` (git, 브랜치 `master`). 계획/스펙은 저장소 `docs/`에 커밋, 구글 드라이브 사본은 수동 동기화.
- **선행 설계:** `docs/superpowers/specs/2026-07-09-roi-dashboard-phase1-dashboard-design.md` (승인됨).
- **DB 접속 역할:** 앱·테스트 모두 비-슈퍼유저 `roi_app`(NOSUPERUSER, NOBYPASSRLS). 슈퍼유저는 RLS를 우회하므로 절대 사용 안 함.
- **로컬 테스트 PG:** 포터블 PostgreSQL을 **5433 포트**로 기동. 꺼져 있으면 먼저:
  `/c/dev/pgsql/bin/pg_ctl -D /c/dev/pgdata -o "-p 5433" -l /c/dev/pgdata/server.log start`
  `.env`/`.env.test`의 `DATABASE_URL`은 `roi_app@localhost:5433`.
- **역할 위계:** `ADMIN > SETTLEMENT > PM`. `hasAtLeast(role, "SETTLEMENT")`은 ADMIN도 통과.
- **모든 데이터 접근은 `withRLS` 경유** (User 테이블 제외 — RLS 미적용). 집계 쿼리도 예외 없음.
- **금액:** 모든 금액은 `Int`(원 단위, 부가세 포함), `≥ 0`. 실적 합은 저장된 `MonthlyPerformance.amount`(단가×횟수로 확정) 합.
- **계약금:** `Task.contractAmount`(nullable). 기간 필터 미적용(총 계약금). null은 합산 제외.
- **연/월 범위:** `year ∈ 2000..2100`, `month ∈ 1..12`.
- **조회 전용:** Plan 3는 읽기만 한다. 변경 액션·`revalidatePath` 없음.
- **KPI 0나눗셈:** 분모 0이면 `null` 반환 → 화면 "—".
- **달성률:** `선택 구간 실적 / 총 계약금`. 모든 KPI 동일 선택 구간.
- **월별 추이:** 월별 실적(막대) + 월별 수익률(라인). 달성률은 추이에서 제외.
- **테스트:** Vitest. DB 테스트는 `roi_app`로 RLS 강제. 커밋은 논리 단위마다 Conventional Commits.
- **Prisma 인터랙티브 트랜잭션 주의:** `withRLS` 콜백 안에서 쿼리는 **순차 await**로 실행한다(같은 tx에서 병렬 쿼리 금지).

---

## File Structure

**신규 생성 (순수 로직, DB 불필요)**
- `src/lib/period.ts` — 기간구분 타입·옵션, `resolvePeriod`, `parsePeriodParams`, `normalizePeriod`.
- `src/lib/metrics/formulas.ts` — `margin`, `attainment`, `billingRate`, `collectionRate` (각 `number | null`).
- `src/lib/csv.ts` — `csvFromRows(rows: string[][]): string` (순수 직렬화).

**수정 (순수)**
- `src/lib/format.ts` — `formatWon`, `formatPercent` 추가(기존 `formatThousands`·`digitsOnly` 유지).
- `src/lib/shell/nav.ts` — "대시보드"(`/dashboard`) 항목 추가.

**신규 생성 (데이터 계층, `withRLS` RLS 테스트)**
- `src/lib/data/metrics.ts` — `getPeriodTotals`, `getContractTotal`, `getMonthlyTrend`, `getExpenseBreakdown`, `getClientSummaries`, `getPmSummaries`, `getClientDetail`.

**신규 생성 (컴포넌트, 프레젠테이션)**
- `src/components/charts/KpiCard.tsx`, `FunnelChart.tsx`, `DonutChart.tsx`, `TrendChart.tsx`, `BarList.tsx`.
- `src/components/dashboard/PeriodFilter.tsx`.

**신규 생성 (화면·라우트)**
- `src/app/(app)/dashboard/page.tsx` — 전사 대시보드.
- `src/app/(app)/clients/[id]/page.tsx` — 고객사 상세.
- `src/app/(app)/clients/[id]/export/route.ts` — CSV route handler(GET).

**수정 (화면)**
- `src/app/page.tsx` — 루트를 `/dashboard`로 리다이렉트.
- `src/app/(app)/clients/page.tsx` — 카드 링크를 `/clients/[id]`로 변경.

**테스트**
- `test/period.test.ts`, `test/metrics-formulas.test.ts`, `test/format.test.ts`, `test/csv.test.ts`, `test/data-metrics.test.ts`, `test/nav.test.ts`(수정).

---

## Task 1: 기간 유틸 (period.ts)

**Files:**
- Create: `src/lib/period.ts`, `test/period.test.ts`

**Interfaces:**
- Consumes: 없음(순수).
- Produces:
  - `type PeriodKey = string` (`"all" | "h1" | "h2" | "1".."12"`).
  - `resolvePeriod(period: string): { startMonth: number; endMonth: number }`.
  - `normalizePeriod(period: string | undefined): PeriodKey`.
  - `parsePeriodParams(sp: { year?: string; period?: string }, fallbackYear: number): { year: number; period: PeriodKey }`.
  - `PERIOD_OPTIONS: { value: PeriodKey; label: string }[]`.

- [ ] **Step 1: 실패 테스트 작성**

Create `test/period.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolvePeriod, normalizePeriod, parsePeriodParams } from "@/lib/period";

describe("resolvePeriod", () => {
  it("maps ranges", () => {
    expect(resolvePeriod("all")).toEqual({ startMonth: 1, endMonth: 12 });
    expect(resolvePeriod("h1")).toEqual({ startMonth: 1, endMonth: 6 });
    expect(resolvePeriod("h2")).toEqual({ startMonth: 7, endMonth: 12 });
    expect(resolvePeriod("3")).toEqual({ startMonth: 3, endMonth: 3 });
    expect(resolvePeriod("12")).toEqual({ startMonth: 12, endMonth: 12 });
  });
  it("falls back to all on invalid", () => {
    expect(resolvePeriod("bogus")).toEqual({ startMonth: 1, endMonth: 12 });
    expect(resolvePeriod("0")).toEqual({ startMonth: 1, endMonth: 12 });
    expect(resolvePeriod("13")).toEqual({ startMonth: 1, endMonth: 12 });
  });
});

describe("normalizePeriod", () => {
  it("keeps valid keys, defaults others to all", () => {
    expect(normalizePeriod("h1")).toBe("h1");
    expect(normalizePeriod("5")).toBe("5");
    expect(normalizePeriod(undefined)).toBe("all");
    expect(normalizePeriod("99")).toBe("all");
  });
});

describe("parsePeriodParams", () => {
  it("uses fallback year when missing/out of range", () => {
    expect(parsePeriodParams({}, 2026)).toEqual({ year: 2026, period: "all" });
    expect(parsePeriodParams({ year: "1999" }, 2026)).toEqual({ year: 2026, period: "all" });
    expect(parsePeriodParams({ year: "2025", period: "h2" }, 2026)).toEqual({ year: 2025, period: "h2" });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- period`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

Create `src/lib/period.ts`:
```ts
export type PeriodKey = string; // "all" | "h1" | "h2" | "1".."12"

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "h1", label: "상반기" },
  { value: "h2", label: "하반기" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` })),
];

export function resolvePeriod(period: string): { startMonth: number; endMonth: number } {
  if (period === "h1") return { startMonth: 1, endMonth: 6 };
  if (period === "h2") return { startMonth: 7, endMonth: 12 };
  const m = Number(period);
  if (Number.isInteger(m) && m >= 1 && m <= 12) return { startMonth: m, endMonth: m };
  return { startMonth: 1, endMonth: 12 }; // "all" 및 잘못된 값
}

export function normalizePeriod(period: string | undefined): PeriodKey {
  if (!period) return "all";
  if (period === "all" || period === "h1" || period === "h2") return period;
  const m = Number(period);
  if (Number.isInteger(m) && m >= 1 && m <= 12) return String(m);
  return "all";
}

export function parsePeriodParams(
  sp: { year?: string; period?: string },
  fallbackYear: number,
): { year: number; period: PeriodKey } {
  const y = Number(sp.year);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : fallbackYear;
  return { year, period: normalizePeriod(sp.period) };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- period`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
cd /c/dev/roi-dashboard
git add src/lib/period.ts test/period.test.ts
git commit -m "feat: add period utilities for dashboard date filtering"
```

---

## Task 2: 지표 공식 (metrics/formulas.ts)

**Files:**
- Create: `src/lib/metrics/formulas.ts`, `test/metrics-formulas.test.ts`

**Interfaces:**
- Consumes: 없음(순수).
- Produces:
  - `margin(performance: number, expense: number): number | null` — `(실적−지출)/실적`, 실적=0 → null.
  - `attainment(performance: number, contract: number): number | null` — `실적/계약금`, 계약금=0 → null.
  - `billingRate(billing: number, performance: number): number | null` — `청구/실적`, 실적=0 → null.
  - `collectionRate(deposit: number, billing: number): number | null` — `입금/청구`, 청구=0 → null.

- [ ] **Step 1: 실패 테스트 작성**

Create `test/metrics-formulas.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { margin, attainment, billingRate, collectionRate } from "@/lib/metrics/formulas";

describe("margin (수익률)", () => {
  it("computes (perf - expense) / perf", () => {
    expect(margin(1000, 300)).toBeCloseTo(0.7);
  });
  it("allows negative (적자)", () => {
    expect(margin(1000, 1500)).toBeCloseTo(-0.5);
  });
  it("returns null when performance is 0", () => {
    expect(margin(0, 300)).toBeNull();
  });
});

describe("attainment (달성률)", () => {
  it("computes perf / contract", () => {
    expect(attainment(600, 1000)).toBeCloseTo(0.6);
  });
  it("returns null when contract is 0 (계약금 없음)", () => {
    expect(attainment(600, 0)).toBeNull();
  });
});

describe("billingRate (청구율)", () => {
  it("computes billing / perf", () => {
    expect(billingRate(800, 1000)).toBeCloseTo(0.8);
  });
  it("returns null when performance is 0", () => {
    expect(billingRate(800, 0)).toBeNull();
  });
});

describe("collectionRate (수금률)", () => {
  it("computes deposit / billing", () => {
    expect(collectionRate(500, 800)).toBeCloseTo(0.625);
  });
  it("returns null when billing is 0", () => {
    expect(collectionRate(500, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- metrics-formulas`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

Create `src/lib/metrics/formulas.ts`:
```ts
export function margin(performance: number, expense: number): number | null {
  if (performance === 0) return null;
  return (performance - expense) / performance;
}

export function attainment(performance: number, contract: number): number | null {
  if (contract === 0) return null;
  return performance / contract;
}

export function billingRate(billing: number, performance: number): number | null {
  if (performance === 0) return null;
  return billing / performance;
}

export function collectionRate(deposit: number, billing: number): number | null {
  if (billing === 0) return null;
  return deposit / billing;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- metrics-formulas`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/metrics/formulas.ts test/metrics-formulas.test.ts
git commit -m "feat: add KPI formula functions with zero-denominator handling"
```

---

## Task 3: 포맷 헬퍼 확장 (format.ts)

**Files:**
- Modify: `src/lib/format.ts`
- Create: `test/format.test.ts`

**Interfaces:**
- Consumes: 기존 `formatThousands`.
- Produces:
  - `formatWon(v: number | null | undefined): string` — `null`/`undefined` → "—", 아니면 `"1,000,000원"`.
  - `formatPercent(v: number | null | undefined): string` — `null`/`undefined` → "—", 아니면 소수1자리 `"70.0%"` (입력은 0~1 비율).

- [ ] **Step 1: 실패 테스트 작성**

Create `test/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatWon, formatPercent, formatThousands } from "@/lib/format";

describe("formatWon", () => {
  it("formats integer won with suffix", () => {
    expect(formatWon(1000000)).toBe("1,000,000원");
    expect(formatWon(0)).toBe("0원");
  });
  it("renders dash for null/undefined", () => {
    expect(formatWon(null)).toBe("—");
    expect(formatWon(undefined)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("formats ratio to one decimal percent", () => {
    expect(formatPercent(0.7)).toBe("70.0%");
    expect(formatPercent(-0.5)).toBe("-50.0%");
  });
  it("renders dash for null/undefined", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });
});

describe("formatThousands (기존 유지)", () => {
  it("still works", () => {
    expect(formatThousands(1000000)).toBe("1,000,000");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- format`
Expected: FAIL — `formatWon`/`formatPercent` 없음.

- [ ] **Step 3: 구현 (기존 파일에 추가)**

Append to `src/lib/format.ts` (기존 `digitsOnly`·`formatThousands`는 그대로 두고 아래를 추가):
```ts
/** 정수 원화. null/undefined → "—". (예: 1000000 → "1,000,000원") */
export function formatWon(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v.toLocaleString("ko-KR")}원`;
}

/** 비율(0~1) → 소수1자리 퍼센트. null/undefined → "—". (예: 0.7 → "70.0%") */
export function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- format`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/format.ts test/format.test.ts
git commit -m "feat: add formatWon and formatPercent display helpers"
```

---

## Task 4: 데이터 계층 — 구간 합계 + 총 계약금

**Files:**
- Create: `src/lib/data/metrics.ts`, `test/data-metrics.test.ts`

**Interfaces:**
- Consumes: `withRLS`/`RlsContext` (`@/lib/rls`), `resolvePeriod` (`@/lib/period`), `prisma` (`@/lib/db`).
- Produces:
  - `type PeriodTotals = { performance: number; billing: number; deposit: number; expense: number }`.
  - `getPeriodTotals(ctx: RlsContext, year: number, period: string): Promise<PeriodTotals>`.
  - `getContractTotal(ctx: RlsContext): Promise<number>`.

- [ ] **Step 1: 실패 테스트 작성**

Create `test/data-metrics.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { createClient } from "@/lib/data/clients";
import { createTask } from "@/lib/data/tasks";
import { upsertPerformanceBatch } from "@/lib/data/performance";
import { upsertExpense } from "@/lib/data/expenses";
import { upsertBilling, upsertDeposit } from "@/lib/data/billing";
import { getPeriodTotals, getContractTotal } from "@/lib/data/metrics";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.monthlyPerformance.deleteMany();
    await tx.monthlyBilling.deleteMany();
    await tx.monthlyDeposit.deleteMany();
    await tx.expense.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany();
}

describe("metrics: period totals & contract total", () => {
  let pmA: string, pmB: string, clientA: string, taskA: string, clientB: string, taskB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    taskA = (await createTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractAmount: 500000 })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
    taskB = (await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000, contractAmount: 800000 })).id;
    // A사: 3월 실적 4회(40000), 지출 3월 5000, 청구 3월 30000, 입금 3월 20000
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4 }] });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 30000 });
    await upsertDeposit(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 20000 });
    // A사: 8월 실적 2회(20000) — 하반기
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 8, rows: [{ taskId: taskA, count: 2 }] });
    // B사: 3월 실적 1회(20000)
    await upsertPerformanceBatch(ADMIN, { clientId: clientB, year: 2026, month: 3, rows: [{ taskId: taskB, count: 1 }] });
  });

  it("ADMIN sees all clients' totals for H1", async () => {
    const t = await getPeriodTotals(ADMIN, 2026, "h1");
    expect(t.performance).toBe(60000); // A 40000 + B 20000 (both 3월)
    expect(t.billing).toBe(30000);
    expect(t.deposit).toBe(20000);
    expect(t.expense).toBe(5000);
  });

  it("period filter narrows to a single month", async () => {
    const t = await getPeriodTotals(ADMIN, 2026, "8");
    expect(t.performance).toBe(20000); // A 8월만
  });

  it("PM A totals include only own client (RLS)", async () => {
    const t = await getPeriodTotals({ userId: pmA, role: "PM" }, 2026, "all");
    expect(t.performance).toBe(60000); // A 3월40000 + 8월20000, B 제외
  });

  it("contract total sums Task.contractAmount, RLS-scoped", async () => {
    expect(await getContractTotal(ADMIN)).toBe(1300000); // 500000 + 800000
    expect(await getContractTotal({ userId: pmA, role: "PM" })).toBe(500000); // A만
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- data-metrics`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

Create `src/lib/data/metrics.ts`:
```ts
import { withRLS, type RlsContext } from "@/lib/rls";
import { resolvePeriod } from "@/lib/period";

export type PeriodTotals = {
  performance: number;
  billing: number;
  deposit: number;
  expense: number;
};

export function getPeriodTotals(
  ctx: RlsContext,
  year: number,
  period: string,
): Promise<PeriodTotals> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  return withRLS(ctx, async (tx) => {
    // 순차 await (같은 tx에서 병렬 쿼리 금지).
    const perf = await tx.monthlyPerformance.aggregate({
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const billing = await tx.monthlyBilling.aggregate({
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const deposit = await tx.monthlyDeposit.aggregate({
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const expense = await tx.expense.aggregate({
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    return {
      performance: perf._sum.amount ?? 0,
      billing: billing._sum.amount ?? 0,
      deposit: deposit._sum.amount ?? 0,
      expense: expense._sum.amount ?? 0,
    };
  });
}

export function getContractTotal(ctx: RlsContext): Promise<number> {
  return withRLS(ctx, async (tx) => {
    const r = await tx.task.aggregate({ _sum: { contractAmount: true } });
    return r._sum.contractAmount ?? 0;
  });
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- data-metrics`
Expected: PASS (4 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/metrics.ts test/data-metrics.test.ts
git commit -m "feat: add period totals and contract total aggregates with RLS"
```

---

## Task 5: 데이터 계층 — 월별 추이 + 지출 구성

**Files:**
- Modify: `src/lib/data/metrics.ts`
- Modify: `test/data-metrics.test.ts`

**Interfaces:**
- Consumes: Task 4의 것 + `ExpenseCategory` (`@prisma/client`).
- Produces:
  - `type TrendPoint = { month: number; performance: number; expense: number }`.
  - `getMonthlyTrend(ctx: RlsContext, year: number): Promise<TrendPoint[]>` — 항상 12행(없는 달 0).
  - `type ExpenseSlice = { category: ExpenseCategory; amount: number }`.
  - `getExpenseBreakdown(ctx: RlsContext, year: number, period: string): Promise<ExpenseSlice[]>`.

- [ ] **Step 1: 실패 테스트 추가**

Append to `test/data-metrics.test.ts` 상단 import에 다음을 추가:
```ts
import { getMonthlyTrend, getExpenseBreakdown } from "@/lib/data/metrics";
```
그리고 새 describe 블록 추가(파일 끝):
```ts
describe("metrics: trend & expense breakdown", () => {
  let pmA: string, clientA: string, taskA: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    taskA = (await createTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000 })).id;
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4 }] });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_TRANSPORT", amount: 3000 });
  });

  it("returns 12 months, zero-filled", async () => {
    const trend = await getMonthlyTrend(ADMIN, 2026);
    expect(trend).toHaveLength(12);
    expect(trend[2]).toEqual({ month: 3, performance: 40000, expense: 8000 });
    expect(trend[0]).toEqual({ month: 1, performance: 0, expense: 0 });
  });

  it("breaks expenses down by category for the period", async () => {
    const slices = await getExpenseBreakdown(ADMIN, 2026, "h1");
    const byCat = Object.fromEntries(slices.map((s) => [s.category, s.amount]));
    expect(byCat["OPS_FOOD"]).toBe(5000);
    expect(byCat["OPS_TRANSPORT"]).toBe(3000);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- data-metrics`
Expected: FAIL — `getMonthlyTrend`/`getExpenseBreakdown` 없음.

- [ ] **Step 3: 구현 (metrics.ts에 추가)**

Append to `src/lib/data/metrics.ts` (상단 import에 `ExpenseCategory` 추가):
```ts
import type { ExpenseCategory } from "@prisma/client";
```
파일 끝에 추가:
```ts
export type TrendPoint = { month: number; performance: number; expense: number };

export function getMonthlyTrend(ctx: RlsContext, year: number): Promise<TrendPoint[]> {
  return withRLS(ctx, async (tx) => {
    const perf = await tx.monthlyPerformance.groupBy({
      by: ["month"],
      where: { year },
      _sum: { amount: true },
    });
    const exp = await tx.expense.groupBy({
      by: ["month"],
      where: { year },
      _sum: { amount: true },
    });
    const perfByMonth = new Map(perf.map((r) => [r.month, r._sum.amount ?? 0]));
    const expByMonth = new Map(exp.map((r) => [r.month, r._sum.amount ?? 0]));
    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      return {
        month,
        performance: perfByMonth.get(month) ?? 0,
        expense: expByMonth.get(month) ?? 0,
      };
    });
  });
}

export type ExpenseSlice = { category: ExpenseCategory; amount: number };

export function getExpenseBreakdown(
  ctx: RlsContext,
  year: number,
  period: string,
): Promise<ExpenseSlice[]> {
  const { startMonth, endMonth } = resolvePeriod(period);
  return withRLS(ctx, async (tx) => {
    const rows = await tx.expense.groupBy({
      by: ["category"],
      where: { year, month: { gte: startMonth, lte: endMonth } },
      _sum: { amount: true },
    });
    return rows.map((r) => ({ category: r.category, amount: r._sum.amount ?? 0 }));
  });
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- data-metrics`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/metrics.ts test/data-metrics.test.ts
git commit -m "feat: add monthly trend and expense breakdown aggregates"
```

---

## Task 6: 데이터 계층 — 고객사별/PM별 집계

**Files:**
- Modify: `src/lib/data/metrics.ts`
- Modify: `test/data-metrics.test.ts`

**Interfaces:**
- Consumes: Task 4·5 + `prisma` (User 조회, RLS 미적용).
- Produces:
  - `type ClientSummary = { id: string; name: string; pmId: string | null; performance: number; expense: number; contract: number }`.
  - `getClientSummaries(ctx: RlsContext, year: number, period: string): Promise<ClientSummary[]>` (이름 오름차순).
  - `type PmSummary = { pmId: string | null; label: string; clientCount: number; performance: number; expense: number }`.
  - `getPmSummaries(ctx: RlsContext, year: number, period: string): Promise<PmSummary[]>` — client.pmId 기준 rollup, pmId null은 `label: "미배정"`.

- [ ] **Step 1: 실패 테스트 추가**

상단 import에 추가:
```ts
import { getClientSummaries, getPmSummaries } from "@/lib/data/metrics";
```
파일 끝에 describe 추가:
```ts
describe("metrics: client & PM summaries", () => {
  let pmA: string, pmB: string, clientA: string, taskA: string, clientB: string, taskB: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", name: "PM A", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", name: "PM B", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    taskA = (await createTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractAmount: 500000 })).id;
    clientB = (await createClient(ADMIN, { name: "B사", pmId: pmB })).id;
    taskB = (await createTask(ADMIN, { clientId: clientB, name: "상담", unitPrice: 20000, contractAmount: 800000 })).id;
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4 }] });
    await upsertExpense(ADMIN, { clientId: clientA, year: 2026, month: 3, category: "OPS_FOOD", amount: 5000 });
    await upsertPerformanceBatch(ADMIN, { clientId: clientB, year: 2026, month: 3, rows: [{ taskId: taskB, count: 1 }] });
  });

  it("client summaries per client (ADMIN)", async () => {
    const rows = await getClientSummaries(ADMIN, 2026, "all");
    expect(rows.map((r) => r.name)).toEqual(["A사", "B사"]);
    const a = rows.find((r) => r.name === "A사")!;
    expect(a).toMatchObject({ performance: 40000, expense: 5000, contract: 500000, pmId: pmA });
  });

  it("PM A sees only own client summary (RLS)", async () => {
    const rows = await getClientSummaries({ userId: pmA, role: "PM" }, 2026, "all");
    expect(rows.map((r) => r.name)).toEqual(["A사"]);
  });

  it("PM summaries roll up by pmId (ADMIN)", async () => {
    const rows = await getPmSummaries(ADMIN, 2026, "all");
    const a = rows.find((r) => r.pmId === pmA)!;
    expect(a).toMatchObject({ label: "PM A", clientCount: 1, performance: 40000, expense: 5000 });
    const b = rows.find((r) => r.pmId === pmB)!;
    expect(b).toMatchObject({ clientCount: 1, performance: 20000 });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- data-metrics`
Expected: FAIL — 함수 없음.

- [ ] **Step 3: 구현 (metrics.ts에 추가)**

상단 import에 추가:
```ts
import { prisma } from "@/lib/db";
```
파일 끝에 추가:
```ts
export type ClientSummary = {
  id: string;
  name: string;
  pmId: string | null;
  performance: number;
  expense: number;
  contract: number;
};

export function getClientSummaries(
  ctx: RlsContext,
  year: number,
  period: string,
): Promise<ClientSummary[]> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  return withRLS(ctx, async (tx) => {
    const clients = await tx.client.findMany({ orderBy: { name: "asc" } });
    const perfRows = await tx.monthlyPerformance.findMany({
      where: { year, month: monthRange },
      select: { amount: true, task: { select: { clientId: true } } },
    });
    const expRows = await tx.expense.groupBy({
      by: ["clientId"],
      where: { year, month: monthRange },
      _sum: { amount: true },
    });
    const contractRows = await tx.task.groupBy({
      by: ["clientId"],
      _sum: { contractAmount: true },
    });
    const perfByClient = new Map<string, number>();
    for (const r of perfRows) {
      const cid = r.task.clientId;
      perfByClient.set(cid, (perfByClient.get(cid) ?? 0) + r.amount);
    }
    const expByClient = new Map(expRows.map((r) => [r.clientId, r._sum.amount ?? 0]));
    const contractByClient = new Map(
      contractRows.map((r) => [r.clientId, r._sum.contractAmount ?? 0]),
    );
    return clients.map((c) => ({
      id: c.id,
      name: c.name,
      pmId: c.pmId,
      performance: perfByClient.get(c.id) ?? 0,
      expense: expByClient.get(c.id) ?? 0,
      contract: contractByClient.get(c.id) ?? 0,
    }));
  });
}

export type PmSummary = {
  pmId: string | null;
  label: string;
  clientCount: number;
  performance: number;
  expense: number;
};

export async function getPmSummaries(
  ctx: RlsContext,
  year: number,
  period: string,
): Promise<PmSummary[]> {
  const clients = await getClientSummaries(ctx, year, period);
  const byPm = new Map<string | null, { clientCount: number; performance: number; expense: number }>();
  for (const c of clients) {
    const cur = byPm.get(c.pmId) ?? { clientCount: 0, performance: 0, expense: 0 };
    byPm.set(c.pmId, {
      clientCount: cur.clientCount + 1,
      performance: cur.performance + c.performance,
      expense: cur.expense + c.expense,
    });
  }
  const pmIds = [...byPm.keys()].filter((k): k is string => k !== null);
  const users = await prisma.user.findMany({ where: { id: { in: pmIds } } });
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return [...byPm.entries()].map(([pmId, agg]) => ({
    pmId,
    label: pmId === null ? "미배정" : labelById.get(pmId) ?? "(알 수 없음)",
    ...agg,
  }));
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- data-metrics`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/metrics.ts test/data-metrics.test.ts
git commit -m "feat: add client and PM rollup summaries with RLS"
```

---

## Task 7: 데이터 계층 — 고객사 상세

**Files:**
- Modify: `src/lib/data/metrics.ts`
- Modify: `test/data-metrics.test.ts`

**Interfaces:**
- Consumes: Task 4~6.
- Produces:
  - `type TaskPerf = { id: string; name: string; unitPrice: number; contractAmount: number | null; count: number; amount: number }`.
  - `type MonthlyRow = { month: number; performance: number; billing: number; deposit: number; expense: number }`.
  - `type ClientDetail = { client: { id: string; name: string; status: string }; tasks: TaskPerf[]; monthly: MonthlyRow[] }`.
  - `getClientDetail(ctx: RlsContext, id: string, year: number, period: string): Promise<ClientDetail | null>` — RLS로 접근 불가/없는 고객사면 `null`. `tasks`는 선택 구간 실적, `monthly`는 12행.

- [ ] **Step 1: 실패 테스트 추가**

상단 import에 추가:
```ts
import { getClientDetail } from "@/lib/data/metrics";
```
파일 끝에 describe 추가:
```ts
describe("metrics: client detail", () => {
  let pmA: string, pmB: string, clientA: string, taskA: string;
  beforeEach(async () => {
    await reset();
    pmA = (await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    pmB = (await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } })).id;
    clientA = (await createClient(ADMIN, { name: "A사", pmId: pmA })).id;
    taskA = (await createTask(ADMIN, { clientId: clientA, name: "진단", unitPrice: 10000, contractAmount: 500000 })).id;
    await upsertPerformanceBatch(ADMIN, { clientId: clientA, year: 2026, month: 3, rows: [{ taskId: taskA, count: 4 }] });
    await upsertBilling(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 30000 });
    await upsertDeposit(ADMIN, { clientId: clientA, year: 2026, month: 3, amount: 20000 });
  });

  it("returns detail with per-task period perf and 12 monthly rows", async () => {
    const d = await getClientDetail(ADMIN, clientA, 2026, "all");
    expect(d).not.toBeNull();
    expect(d!.client.name).toBe("A사");
    expect(d!.tasks[0]).toMatchObject({ name: "진단", unitPrice: 10000, contractAmount: 500000, count: 4, amount: 40000 });
    expect(d!.monthly).toHaveLength(12);
    expect(d!.monthly[2]).toEqual({ month: 3, performance: 40000, billing: 30000, deposit: 20000, expense: 0 });
  });

  it("returns null for another PM's client (RLS)", async () => {
    const d = await getClientDetail({ userId: pmB, role: "PM" }, clientA, 2026, "all");
    expect(d).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- data-metrics`
Expected: FAIL — `getClientDetail` 없음.

- [ ] **Step 3: 구현 (metrics.ts에 추가)**

파일 끝에 추가:
```ts
export type TaskPerf = {
  id: string;
  name: string;
  unitPrice: number;
  contractAmount: number | null;
  count: number;
  amount: number;
};

export type MonthlyRow = {
  month: number;
  performance: number;
  billing: number;
  deposit: number;
  expense: number;
};

export type ClientDetail = {
  client: { id: string; name: string; status: string };
  tasks: TaskPerf[];
  monthly: MonthlyRow[];
};

export function getClientDetail(
  ctx: RlsContext,
  id: string,
  year: number,
  period: string,
): Promise<ClientDetail | null> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  return withRLS(ctx, async (tx) => {
    const client = await tx.client.findUnique({ where: { id } });
    if (!client) return null; // 없거나 RLS로 은닉

    const tasks = await tx.task.findMany({ where: { clientId: id }, orderBy: { name: "asc" } });
    const perfRows = await tx.monthlyPerformance.findMany({
      where: { year, month: monthRange, task: { clientId: id } },
      select: { taskId: true, count: true, amount: true },
    });
    const perfByTask = new Map<string, { count: number; amount: number }>();
    for (const r of perfRows) {
      const cur = perfByTask.get(r.taskId) ?? { count: 0, amount: 0 };
      perfByTask.set(r.taskId, { count: cur.count + r.count, amount: cur.amount + r.amount });
    }
    const taskRows: TaskPerf[] = tasks.map((t) => ({
      id: t.id,
      name: t.name,
      unitPrice: t.unitPrice,
      contractAmount: t.contractAmount,
      count: perfByTask.get(t.id)?.count ?? 0,
      amount: perfByTask.get(t.id)?.amount ?? 0,
    }));

    const perfM = await tx.monthlyPerformance.groupBy({
      by: ["month"], where: { year, task: { clientId: id } }, _sum: { amount: true },
    });
    const billM = await tx.monthlyBilling.groupBy({
      by: ["month"], where: { year, clientId: id }, _sum: { amount: true },
    });
    const depM = await tx.monthlyDeposit.groupBy({
      by: ["month"], where: { year, clientId: id }, _sum: { amount: true },
    });
    const expM = await tx.expense.groupBy({
      by: ["month"], where: { year, clientId: id }, _sum: { amount: true },
    });
    const map = (rows: { month: number; _sum: { amount: number | null } }[]) =>
      new Map(rows.map((r) => [r.month, r._sum.amount ?? 0]));
    const p = map(perfM), b = map(billM), d = map(depM), e = map(expM);
    const monthly: MonthlyRow[] = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      return {
        month,
        performance: p.get(month) ?? 0,
        billing: b.get(month) ?? 0,
        deposit: d.get(month) ?? 0,
        expense: e.get(month) ?? 0,
      };
    });

    return { client: { id: client.id, name: client.name, status: client.status }, tasks: taskRows, monthly };
  });
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- data-metrics`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/metrics.ts test/data-metrics.test.ts
git commit -m "feat: add client detail aggregate (per-task + 12-month rows) with RLS"
```

---

## Task 8: CSV 직렬화 (csv.ts)

**Files:**
- Create: `src/lib/csv.ts`, `test/csv.test.ts`

**Interfaces:**
- Consumes: 없음(순수).
- Produces: `csvFromRows(rows: string[][]): string` — RFC4180 스타일. 콤마·따옴표·개행 포함 셀은 `"`로 감싸고 내부 `"`는 `""`로 이스케이프. 행 구분 `\r\n`.

- [ ] **Step 1: 실패 테스트 작성**

Create `test/csv.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { csvFromRows } from "@/lib/csv";

describe("csvFromRows", () => {
  it("joins rows with CRLF and cells with comma", () => {
    expect(csvFromRows([["월", "실적"], ["3", "40000"]])).toBe("월,실적\r\n3,40000");
  });
  it("quotes cells containing comma or quote or newline", () => {
    expect(csvFromRows([['a,b', 'he said "hi"', "line\nbreak"]])).toBe('"a,b","he said ""hi""","line\nbreak"');
  });
  it("handles empty input", () => {
    expect(csvFromRows([])).toBe("");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- csv`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

Create `src/lib/csv.ts`:
```ts
function escapeCell(cell: string): string {
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/** 2차원 문자열 배열 → CSV 문자열 (셀 이스케이프, 행 구분 CRLF). */
export function csvFromRows(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- csv`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/csv.ts test/csv.test.ts
git commit -m "feat: add CSV serialization helper"
```

---

## Task 9: 네비게이션에 대시보드 추가 (nav.ts)

**Files:**
- Modify: `src/lib/shell/nav.ts`
- Modify: `test/nav.test.ts`

**Interfaces:**
- Consumes: `AppRole`.
- Produces: 역할 있는 사용자의 메뉴 첫 항목이 `{ href: "/dashboard", label: "대시보드" }`. null 역할은 기존 base 유지.

- [ ] **Step 1: 테스트를 새 기대로 수정 (실패 확인용)**

Replace `test/nav.test.ts` with:
```ts
import { describe, it, expect } from "vitest";
import { navItemsForRole } from "@/lib/shell/nav";

const hrefs = (role: Parameters<typeof navItemsForRole>[0]) => navItemsForRole(role).map((i) => i.href);

describe("navItemsForRole", () => {
  it("PM sees dashboard first, then clients/performance/expenses/billing", () => {
    expect(hrefs("PM")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing"]);
  });
  it("SETTLEMENT adds settings", () => {
    expect(hrefs("SETTLEMENT")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients"]);
  });
  it("ADMIN adds user management", () => {
    expect(hrefs("ADMIN")).toEqual(["/dashboard", "/clients", "/performance", "/expenses", "/billing", "/settings/clients", "/admin/users"]);
  });
  it("null role sees base items only (no dashboard)", () => {
    expect(hrefs(null)).toEqual(["/clients", "/performance"]);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- nav`
Expected: FAIL — 대시보드 항목 없음.

- [ ] **Step 3: 구현**

Replace `src/lib/shell/nav.ts` with:
```ts
import type { AppRole } from "@/lib/auth/rbac";

export type NavItem = { href: string; label: string };

export function navItemsForRole(role: AppRole | null): NavItem[] {
  const items: NavItem[] = [];
  // 대시보드는 역할이 부여된(승인된) 사용자에게만. getRlsContext는 role null이면 throw.
  if (role) items.push({ href: "/dashboard", label: "대시보드" });
  items.push({ href: "/clients", label: "고객사 목록" });
  items.push({ href: "/performance", label: "실적 입력" });
  // 실적·지출·청구/입금 입력은 역할이 부여된 사용자 모두. RLS가 담당 고객사로 범위 제한.
  if (role) {
    items.push({ href: "/expenses", label: "지출 입력" });
    items.push({ href: "/billing", label: "청구·입금 입력" });
  }
  // 고객사·과업·단가 설정은 정산담당자/관리자만.
  if (role === "SETTLEMENT" || role === "ADMIN") {
    items.push({ href: "/settings/clients", label: "설정" });
  }
  if (role === "ADMIN") items.push({ href: "/admin/users", label: "사용자 관리" });
  return items;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- nav`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/shell/nav.ts test/nav.test.ts
git commit -m "feat: add dashboard nav item for approved users"
```

---

## Task 10: 차트 컴포넌트 (정적 SVG/CSS)

**Files:**
- Create: `src/components/charts/KpiCard.tsx`, `FunnelChart.tsx`, `DonutChart.tsx`, `TrendChart.tsx`, `BarList.tsx`

**Interfaces:**
- Consumes: 없음(프레젠테이션). 값은 사전 계산된 숫자/문자열 props로 받는다.
- Produces:
  - `KpiCard({ title, value, sub? }: { title: string; value: string; sub?: string })`.
  - `FunnelChart({ steps }: { steps: { label: string; amount: number; rate: string | null }[] })`.
  - `DonutChart({ segments }: { segments: { label: string; value: number }[] })`.
  - `TrendChart({ points }: { points: { month: number; performance: number; margin: number | null }[] })`.
  - `BarList({ items }: { items: { label: string; value: number; sub?: string }[] })`.
- 검증: 단위 테스트 없음(순수 프레젠테이션). `npm run build`로 타입/렌더 검증.

- [ ] **Step 1: KpiCard 작성**

Create `src/components/charts/KpiCard.tsx`:
```tsx
export function KpiCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="text-xs text-[var(--color-muted)]">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-[var(--color-fg)]">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--color-muted)]">{sub}</div>}
    </div>
  );
}
```

- [ ] **Step 2: FunnelChart 작성**

Create `src/components/charts/FunnelChart.tsx`:
```tsx
import { formatWon } from "@/lib/format";

export function FunnelChart({
  steps,
}: {
  steps: { label: string; amount: number; rate: string | null }[];
}) {
  const max = Math.max(1, ...steps.map((s) => s.amount));
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center gap-3">
          <div className="w-16 shrink-0 text-xs text-[var(--color-muted)]">{s.label}</div>
          <div className="relative h-7 flex-1 rounded bg-[var(--color-bg)]">
            <div
              className="h-7 rounded bg-[var(--color-primary)]"
              style={{ width: `${(s.amount / max) * 100}%` }}
            />
          </div>
          <div className="w-32 shrink-0 text-right text-xs text-[var(--color-fg)]">{formatWon(s.amount)}</div>
          <div className="w-16 shrink-0 text-right text-xs text-[var(--color-muted)]">{s.rate ?? ""}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: DonutChart 작성**

Create `src/components/charts/DonutChart.tsx`:
```tsx
import { formatWon } from "@/lib/format";

const COLORS = [
  "#2563EB", "#10B981", "#F43F5E", "#F59E0B", "#8B5CF6", "#06B6D4", "#EC4899",
  "#84CC16", "#6366F1", "#14B8A6", "#EF4444", "#A855F7", "#64748B",
];

export function DonutChart({ segments }: { segments: { label: string; value: number }[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <p className="text-sm text-[var(--color-muted)]">데이터가 없습니다.</p>;
  }
  const R = 60, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <g transform="translate(80,80) rotate(-90)">
          {segments.map((s, i) => {
            const frac = s.value / total;
            const dash = frac * C;
            const el = (
              <circle
                key={s.label}
                r={R}
                fill="none"
                stroke={COLORS[i % COLORS.length]}
                strokeWidth="24"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </g>
      </svg>
      <ul className="flex flex-col gap-1 text-xs">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="w-40 text-[var(--color-fg)]">{s.label}</span>
            <span className="w-28 text-right text-[var(--color-fg)]">{formatWon(s.value)}</span>
            <span className="w-12 text-right text-[var(--color-muted)]">{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: TrendChart 작성**

Create `src/components/charts/TrendChart.tsx`:
```tsx
export function TrendChart({
  points,
}: {
  points: { month: number; performance: number; margin: number | null }[];
}) {
  const W = 720, H = 200, pad = 24;
  const maxPerf = Math.max(1, ...points.map((p) => p.performance));
  const barW = (W - pad * 2) / points.length;
  const x = (i: number) => pad + i * barW + barW / 2;
  const yPerf = (v: number) => H - pad - (v / maxPerf) * (H - pad * 2);
  // 수익률 라인: -1..1 → H 매핑 (0.5 중앙 기준 단순화: 0=하단 pad, 1=상단 pad)
  const yMargin = (m: number) => {
    const clamped = Math.max(0, Math.min(1, m));
    return H - pad - clamped * (H - pad * 2);
  };
  const linePts = points
    .filter((p) => p.margin !== null)
    .map((p) => `${x(points.indexOf(p))},${yMargin(p.margin as number)}`)
    .join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="max-w-full">
      {points.map((p, i) => (
        <rect
          key={p.month}
          x={x(i) - barW * 0.35}
          y={yPerf(p.performance)}
          width={barW * 0.7}
          height={H - pad - yPerf(p.performance)}
          fill="var(--color-primary)"
          opacity="0.85"
        />
      ))}
      {linePts && <polyline points={linePts} fill="none" stroke="var(--color-success)" strokeWidth="2" />}
      {points.map((p, i) => (
        <text key={p.month} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
          {p.month}
        </text>
      ))}
    </svg>
  );
}
```

- [ ] **Step 5: BarList 작성**

Create `src/components/charts/BarList.tsx`:
```tsx
import { formatWon } from "@/lib/format";

export function BarList({ items }: { items: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) {
    return <p className="text-sm text-[var(--color-muted)]">데이터가 없습니다.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate text-xs text-[var(--color-fg)]">{it.label}</div>
          <div className="relative h-5 flex-1 rounded bg-[var(--color-bg)]">
            <div className="h-5 rounded bg-[var(--color-primary)]" style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
          <div className="w-28 shrink-0 text-right text-xs text-[var(--color-fg)]">{formatWon(it.value)}</div>
          {it.sub && <div className="w-16 shrink-0 text-right text-xs text-[var(--color-muted)]">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: 빌드 확인 및 커밋**

Run: `npm run build`
Expected: 성공(타입 에러 없음).
```bash
git add src/components/charts
git commit -m "feat: add SVG/CSS chart components (KPI, funnel, donut, trend, bar list)"
```

---

## Task 11: 기간 필터 컴포넌트 (PeriodFilter)

**Files:**
- Create: `src/components/dashboard/PeriodFilter.tsx`

**Interfaces:**
- Consumes: `PERIOD_OPTIONS`, `PeriodKey` (`@/lib/period`).
- Produces: `PeriodFilter({ year, period, action? }: { year: number; period: string; action?: string })` — `method="get"` 폼. 연도 입력 + 기간구분 select + 조회 버튼. `action`은 폼 제출 경로(기본 현재 경로 — 생략 시 빈 문자열로 현재 URL 유지).

- [ ] **Step 1: 구현**

Create `src/components/dashboard/PeriodFilter.tsx`:
```tsx
import { PERIOD_OPTIONS } from "@/lib/period";

export function PeriodFilter({ year, period, action }: { year: number; period: string; action?: string }) {
  return (
    <form method="get" action={action} className="mb-6 flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        연도
        <input
          type="number"
          name="year"
          defaultValue={year}
          className="w-24 rounded border border-[var(--color-border)] px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        기간
        <select
          name="period"
          defaultValue={period}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-sm"
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">
        조회
      </button>
    </form>
  );
}
```

- [ ] **Step 2: 빌드 확인 및 커밋**

Run: `npm run build`
Expected: 성공.
```bash
git add src/components/dashboard/PeriodFilter.tsx
git commit -m "feat: add period filter form component"
```

---

## Task 12: 전사 대시보드 화면 (/dashboard) + 루트 리다이렉트

**Files:**
- Create: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `requireUser`, `getRlsContext`, `hasAtLeast`, `parsePeriodParams`, `getPeriodTotals`/`getContractTotal`/`getMonthlyTrend`/`getExpenseBreakdown`/`getClientSummaries`/`getPmSummaries`, `margin`/`attainment`/`billingRate`/`collectionRate`, `formatWon`/`formatPercent`, `expenseCategoryLabel`, 차트 컴포넌트, `PeriodFilter`.
- Produces: 전사 대시보드 화면. PM은 RLS로 본인 담당만 집계. PM별 집계 섹션은 `hasAtLeast(role,"SETTLEMENT")`일 때만.

- [ ] **Step 1: 루트를 대시보드로 리다이렉트**

Replace `src/app/page.tsx` with:
```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

export default async function HomePage() {
  await requireUser(); // 미인증/미승인은 여기서 리다이렉트
  redirect("/dashboard");
}
```

- [ ] **Step 2: 대시보드 페이지 작성**

Create `src/app/(app)/dashboard/page.tsx`:
```tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { hasAtLeast } from "@/lib/auth/rbac";
import { parsePeriodParams } from "@/lib/period";
import {
  getPeriodTotals, getContractTotal, getMonthlyTrend,
  getExpenseBreakdown, getClientSummaries, getPmSummaries,
} from "@/lib/data/metrics";
import { margin, attainment, billingRate, collectionRate } from "@/lib/metrics/formulas";
import { formatWon, formatPercent } from "@/lib/format";
import { expenseCategoryLabel } from "@/lib/labels";
import { KpiCard } from "@/components/charts/KpiCard";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { TrendChart } from "@/components/charts/TrendChart";
import { BarList } from "@/components/charts/BarList";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const { year, period } = parsePeriodParams(sp, new Date().getFullYear());

  const totals = await getPeriodTotals(ctx, year, period);
  const contract = await getContractTotal(ctx);
  const trend = await getMonthlyTrend(ctx, year);
  const breakdown = await getExpenseBreakdown(ctx, year, period);
  const clients = await getClientSummaries(ctx, year, period);
  const showPm = hasAtLeast(user.role, "SETTLEMENT");
  const pms = showPm ? await getPmSummaries(ctx, year, period) : [];

  const marginV = margin(totals.performance, totals.expense);
  const attainmentV = attainment(totals.performance, contract);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">전사 대시보드</h1>
      <PeriodFilter year={year} period={period} />

      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard title="수익률" value={formatPercent(marginV)} />
        <KpiCard title="실적 달성률" value={formatPercent(attainmentV)} sub={`계약금 ${formatWon(contract)}`} />
        <KpiCard title="총 실적" value={formatWon(totals.performance)} />
        <KpiCard title="총 지출" value={formatWon(totals.expense)} />
        <KpiCard title="총 입금" value={formatWon(totals.deposit)} />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">수익 흐름</h2>
        <FunnelChart
          steps={[
            { label: "계약금", amount: contract, rate: null },
            { label: "실적", amount: totals.performance, rate: formatPercent(attainmentV) },
            { label: "청구", amount: totals.billing, rate: formatPercent(billingRate(totals.billing, totals.performance)) },
            { label: "입금", amount: totals.deposit, rate: formatPercent(collectionRate(totals.deposit, totals.billing)) },
          ]}
        />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">월별 추이 (실적 막대 · 수익률 라인)</h2>
        <TrendChart
          points={trend.map((t) => ({
            month: t.month,
            performance: t.performance,
            margin: margin(t.performance, t.expense),
          }))}
        />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">지출 구성</h2>
        <DonutChart segments={breakdown.map((s) => ({ label: expenseCategoryLabel(s.category), value: s.amount }))} />
      </section>

      {showPm && (
        <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">PM별 집계</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                <th className="py-2">PM</th><th>담당 고객사</th><th>실적</th><th>지출</th><th>수익률</th>
              </tr>
            </thead>
            <tbody>
              {pms.map((p) => (
                <tr key={p.pmId ?? "none"} className="border-b border-[var(--color-border)]">
                  <td className="py-2">{p.label}</td>
                  <td>{p.clientCount}</td>
                  <td>{formatWon(p.performance)}</td>
                  <td>{formatWon(p.expense)}</td>
                  <td>{formatPercent(margin(p.performance, p.expense))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">고객사별 요약</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
              <th className="py-2">고객사</th><th>실적</th><th>지출</th><th>수익률</th><th>달성률</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-b border-[var(--color-border)]">
                <td className="py-2">
                  <Link href={`/clients/${c.id}`} className="text-[var(--color-primary)]">{c.name}</Link>
                </td>
                <td>{formatWon(c.performance)}</td>
                <td>{formatWon(c.expense)}</td>
                <td>{formatPercent(margin(c.performance, c.expense))}</td>
                <td>{formatPercent(attainment(c.performance, c.contract))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/dashboard/page.tsx" src/app/page.tsx
git commit -m "feat: add company-wide dashboard and redirect root to it"
```

---

## Task 13: 고객사 상세 화면 (/clients/[id]) + 목록 링크 변경

**Files:**
- Create: `src/app/(app)/clients/[id]/page.tsx`
- Modify: `src/app/(app)/clients/page.tsx`

**Interfaces:**
- Consumes: `requireUser`, `getRlsContext`, `parsePeriodParams`, `getClientDetail`, `margin`/`attainment`/`billingRate`/`collectionRate`, `formatWon`/`formatPercent`, `notFound`, 차트·`PeriodFilter`.
- Produces: 고객사 상세 화면(KPI + 수익 흐름 + 과업별 실적 + 월별 표(미입금 강조) + CSV 링크). 목록 카드는 `/clients/[id]`로 링크.

- [ ] **Step 1: 목록 카드 링크 변경**

In `src/app/(app)/clients/page.tsx`, change the card `href`:
```tsx
              href={`/clients/${c.id}`}
```
(기존 `href={`/performance?clientId=${c.id}`}` 를 위로 교체.)

- [ ] **Step 2: 상세 페이지 작성**

Create `src/app/(app)/clients/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { parsePeriodParams } from "@/lib/period";
import { getClientDetail } from "@/lib/data/metrics";
import { margin, attainment, billingRate, collectionRate } from "@/lib/metrics/formulas";
import { formatWon, formatPercent } from "@/lib/format";
import { KpiCard } from "@/components/charts/KpiCard";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const { year, period } = parsePeriodParams(sp, new Date().getFullYear());

  const detail = await getClientDetail(ctx, id, year, period);
  if (!detail) notFound();

  const perf = detail.tasks.reduce((s, t) => s + t.amount, 0);
  const contract = detail.tasks.reduce((s, t) => s + (t.contractAmount ?? 0), 0);
  const billing = detail.monthly.reduce((s, m) => s + m.billing, 0);
  const deposit = detail.monthly.reduce((s, m) => s + m.deposit, 0);
  const expense = detail.monthly.reduce((s, m) => s + m.expense, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{detail.client.name}</h1>
        <a
          href={`/clients/${id}/export?year=${year}&period=${period}`}
          className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-primary)]"
        >
          CSV 내보내기
        </a>
      </div>
      <PeriodFilter year={year} period={period} action={`/clients/${id}`} />

      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="수익률" value={formatPercent(margin(perf, expense))} />
        <KpiCard title="달성률" value={formatPercent(attainment(perf, contract))} sub={`계약금 ${formatWon(contract)}`} />
        <KpiCard title="청구율" value={formatPercent(billingRate(billing, perf))} />
        <KpiCard title="수금률" value={formatPercent(collectionRate(deposit, billing))} />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">수익 흐름</h2>
        <FunnelChart
          steps={[
            { label: "계약금", amount: contract, rate: null },
            { label: "실적", amount: perf, rate: formatPercent(attainment(perf, contract)) },
            { label: "청구", amount: billing, rate: formatPercent(billingRate(billing, perf)) },
            { label: "입금", amount: deposit, rate: formatPercent(collectionRate(deposit, billing)) },
          ]}
        />
      </section>

      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">과업별 실적 (선택 구간)</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
              <th className="py-2">과업</th><th>단가</th><th>계약금</th><th>횟수</th><th>금액</th>
            </tr>
          </thead>
          <tbody>
            {detail.tasks.map((t) => (
              <tr key={t.id} className="border-b border-[var(--color-border)]">
                <td className="py-2">{t.name}</td>
                <td>{formatWon(t.unitPrice)}</td>
                <td>{t.contractAmount == null ? "—" : formatWon(t.contractAmount)}</td>
                <td>{t.count}</td>
                <td>{formatWon(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">월별 실적·청구·입금 ({year})</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
              <th className="py-2">월</th><th>실적</th><th>청구</th><th>입금</th><th>지출</th><th>미수금</th>
            </tr>
          </thead>
          <tbody>
            {detail.monthly.map((m) => {
              const unpaid = m.billing - m.deposit;
              const isUnpaid = unpaid > 0;
              return (
                <tr key={m.month} className="border-b border-[var(--color-border)]">
                  <td className="py-2">{m.month}월</td>
                  <td>{formatWon(m.performance)}</td>
                  <td>{formatWon(m.billing)}</td>
                  <td>{formatWon(m.deposit)}</td>
                  <td>{formatWon(m.expense)}</td>
                  <td className={isUnpaid ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-muted)]"}>
                    {isUnpaid ? formatWon(unpaid) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-4">
          <Link href="/dashboard" className="text-sm text-[var(--color-primary)]">← 전사 대시보드</Link>
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/clients/[id]/page.tsx" "src/app/(app)/clients/page.tsx"
git commit -m "feat: add client detail screen with unpaid highlighting; link list to detail"
```

---

## Task 14: CSV 내보내기 route handler

**Files:**
- Create: `src/app/(app)/clients/[id]/export/route.ts`

**Interfaces:**
- Consumes: `requireUser`, `getRlsContext`, `parsePeriodParams`, `getClientDetail`, `csvFromRows`.
- Produces: `GET` route handler. `?year=&period=` → 월별 실적·청구·입금·지출 CSV. UTF-8 BOM 포함 `text/csv` 응답. RLS로 접근 불가/없는 고객사면 404.

- [ ] **Step 1: route handler 작성**

Create `src/app/(app)/clients/[id]/export/route.ts`:
```ts
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { parsePeriodParams } from "@/lib/period";
import { getClientDetail } from "@/lib/data/metrics";
import { csvFromRows } from "@/lib/csv";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const url = new URL(req.url);
  const { year, period } = parsePeriodParams(
    { year: url.searchParams.get("year") ?? undefined, period: url.searchParams.get("period") ?? undefined },
    new Date().getFullYear(),
  );

  const detail = await getClientDetail(ctx, id, year, period);
  if (!detail) return new Response("Not found", { status: 404 });

  const rows: string[][] = [
    ["월", "실적", "청구", "입금", "지출"],
    ...detail.monthly.map((m) => [
      String(m.month), String(m.performance), String(m.billing), String(m.deposit), String(m.expense),
    ]),
  ];
  const csv = "﻿" + csvFromRows(rows); // Excel 한글 호환 BOM
  const filename = encodeURIComponent(`${detail.client.name}_${year}_${period}.csv`);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/clients/[id]/export/route.ts"
git commit -m "feat: add client CSV export route handler with BOM"
```

---

## Task 15: 최종 검증

**Files:**
- 없음(검증만).

**Interfaces:**
- Consumes: 전체.
- Produces: 전 테스트 통과 + 빌드 성공 확인.

- [ ] **Step 1: 전체 테스트 실행**

로컬 PG(5433)가 켜져 있어야 한다. 꺼져 있으면 Global Constraints의 기동 명령을 먼저 실행.
```bash
cd /c/dev/roi-dashboard
npm run test
```
Expected: 모든 테스트 PASS (period, metrics-formulas, format, csv, data-metrics, nav + Plan 1·2 기존 테스트).

- [ ] **Step 2: 빌드 확인**

```bash
npm run build
```
Expected: 성공.

- [ ] **Step 3: (선택) 수동 확인**

`npm run dev` 후 @huno.kr 로그인:
- 로그인 직후 `/`가 `/dashboard`로 이동, 사이드바에 "대시보드" 표시.
- 기간 필터(연도·전체/상반기/하반기/특정월) 변경 시 KPI·차트 갱신.
- 고객사별 요약 → 고객사명 클릭 → 상세 화면(과업별·월별, 미수금 빨강 강조).
- 상세에서 "CSV 내보내기" → 한글 정상 표시되는 CSV 다운로드.
- ADMIN/SETTLEMENT는 "PM별 집계" 섹션 표시, PM 계정은 미표시 + 본인 담당만 집계.

- [ ] **Step 4: 완료 커밋(문서 체크박스 갱신 시)**

계획 체크박스를 갱신했다면:
```bash
git add docs/superpowers/plans/2026-07-09-roi-dashboard-phase3-dashboard.md
git commit -m "docs: mark Plan 3 tasks complete"
```

---

## Self-Review 결과

**Spec coverage (설계 문서 대비):**
- §2 범위(전사 대시보드·고객사 상세·기간 필터·PM별 집계·CSV·미입금 강조·SVG 차트·nav) → Task 9~14.
- §3 아키텍처(순수 period/formulas/csv + withRLS metrics + 차트 RSC) → Task 1·2·8(순수), 4~7(데이터), 10·11(컴포넌트).
- §4 화면/라우트(/dashboard, /clients/[id], export, 루트 리다이렉트, nav, 목록 링크) → Task 9·12·13·14.
- §5 데이터 계층 7함수 + csvFromRows → Task 4·5·6·7·8.
- §6 지표 공식(4종 + 0나눗셈) → Task 2. formatWon/formatPercent → Task 3.
- §7 인가·에러(requireUser, PM별 게이트 hasAtLeast, 상세 notFound, RLS, 조회 전용) → Task 12·13·14.
- §8 테스트(period·formulas·format·csv 순수 + data-metrics RLS 격리 + nav) → Task 1·2·3·8·4~7·9.

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. TBD/TODO 없음.

**Type consistency:** `RlsContext{userId,role}`, `PeriodTotals`, `TrendPoint`, `ExpenseSlice`, `ClientSummary`, `PmSummary`, `TaskPerf`/`MonthlyRow`/`ClientDetail`가 데이터 계층 정의와 화면 소비에서 일관. 지표 함수 시그니처(`margin(performance,expense)` 등)가 대시보드·상세·PM표에서 동일하게 호출됨. `parsePeriodParams(sp, fallbackYear)` 시그니처가 대시보드·상세·route handler에서 일관. 차트 props 타입이 컴포넌트 정의와 호출부에서 일치(`FunnelChart.steps[].rate: string | null` ← 화면이 `formatPercent(...)` 또는 `null` 전달).

**주의(구현 시):**
- Prisma 인터랙티브 트랜잭션 안에서는 쿼리를 순차 await(병렬 금지).
- `getClientDetail`의 `map` 헬퍼는 groupBy 결과 4종에 재사용 — 타입 `{ month: number; _sum: { amount: number | null } }[]`.
- `TrendChart`의 수익률 라인은 0~1로 clamp(적자 음수는 하단 고정) — Phase 1 단순화. 필요 시 후속 개선.
