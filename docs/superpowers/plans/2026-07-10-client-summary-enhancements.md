# 고객사별 요약·과업별 실적 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수익률 대시보드에 업종 필드, 고객사 편집 화면, 과업별 월 매트릭스, 고객사별 요약의 검색·정렬·페이지네이션을 추가한다.

**Architecture:** 기존 구조(Next 서버 컴포넌트 + server action + Prisma `withRLS`)를 그대로 따른다. 데이터/검증은 Vitest로 TDD하고, 대시보드의 검색·정렬·페이지네이션은 순수 헬퍼로 분리해 단위 테스트한 뒤 클라이언트 컴포넌트가 그 헬퍼를 조합만 한다.

**Tech Stack:** Next 16 (App Router), React 19, Prisma 6 (PostgreSQL), zod 4, Tailwind v4, Vitest 4.

## Global Constraints

- 데이터 접근은 항상 `withRLS(ctx, tx => …)` 안에서. 사용자 이름 조회처럼 RLS 밖 참조는 기존 `getPmSummaries`처럼 평범한 `prisma.user.findMany`로 한다.
- 테스트 환경은 `environment: "node"`라 React 컴포넌트 테스트는 없다. UI 로직은 순수 함수로 분리해 테스트한다.
- 모든 UI 문구는 한국어. 스타일은 기존 `var(--color-*)` Tailwind 토큰과 동일 클래스 패턴 사용.
- 한글 정렬은 `localeCompare(…, "ko")`.
- 업종은 자유 텍스트(고정 목록 아님). 검색은 고객사명만. 정렬 토글은 순서만 바꾼다(그룹 헤더 없음). 과업 매트릭스 셀은 금액만.
- 빈 입력값 매핑은 기존 zod 패턴을 따른다(`pmId`: 빈 문자열→null).
- 테스트/빌드 명령: `npm test`(vitest run), `npm run build`. 테스트는 로컬 PG(5433)가 떠 있어야 하며 `test/global-setup.ts`가 `prisma migrate deploy`로 마이그레이션을 적용한다.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- `prisma/schema.prisma` — `Client.industry` 추가 (수정)
- `prisma/migrations/<ts>_add_client_industry/migration.sql` — 마이그레이션 (생성, prisma가 생성)
- `src/lib/validation/schemas.ts` — `clientSchema`에 `industry` (수정)
- `src/lib/data/clients.ts` — `ClientInput`/`createClient`/`updateClient`에 `industry` (수정)
- `src/lib/data/metrics.ts` — `getClientDetail`(과업 월 매트릭스), `getClientSummaries`(pmLabel·industry) (수정)
- `src/lib/clients/summary-view.ts` — 검색/정렬/페이지네이션 순수 헬퍼 (생성)
- `src/app/(app)/settings/clients/actions.ts` — 두 액션에 `industry` (수정)
- `src/app/(app)/settings/clients/NewClientForm.tsx` — 업종 입력칸 (수정)
- `src/app/(app)/settings/clients/[id]/EditClientForm.tsx` — 고객사 편집 폼 (생성)
- `src/app/(app)/settings/clients/[id]/page.tsx` — 편집 폼 + PM 목록 조회 (수정)
- `src/app/(app)/clients/[id]/page.tsx` — 과업별 월 매트릭스 표 (수정)
- `src/components/dashboard/ClientSummaryTable.tsx` — 검색/정렬/페이지네이션 표 (생성)
- `src/app/(app)/dashboard/page.tsx` — 고객사별 요약을 컴포넌트로 교체 (수정)
- 테스트: `test/schemas.test.ts`, `test/data-clients.test.ts`, `test/data-metrics.test.ts` (수정), `test/client-summary-sort.test.ts` (생성)

---

## Task 1: 업종 필드 — 스키마·검증·데이터 계층

**Files:**
- Modify: `prisma/schema.prisma` (Client 모델)
- Modify: `src/lib/validation/schemas.ts:34-40` (clientSchema)
- Modify: `src/lib/data/clients.ts:4-51` (ClientInput, createClient, updateClient)
- Test: `test/schemas.test.ts`, `test/data-clients.test.ts`

**Interfaces:**
- Produces: `clientSchema`에 `industry: string | null` (선택), `ClientInput.industry?: string | null`, `createClient`/`updateClient`가 industry를 저장/patch.

- [x] **Step 1: schema.prisma에 industry 추가**

`Client` 모델의 `status` 줄 아래에 추가:

```prisma
model Client {
  id           String   @id @default(cuid())
  name         String
  status       String   @default("진행중")
  industry     String?
  contractStart DateTime?
  contractEnd   DateTime?
  pmId         String?
  pm           User?    @relation("ClientPM", fields: [pmId], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  tasks        Task[]
  billings     MonthlyBilling[]
  deposits     MonthlyDeposit[]
  expenses     Expense[]

  @@index([pmId])
}
```

- [x] **Step 2: 마이그레이션 생성·적용**

Run: `cd /c/dev/roi-dashboard && npx prisma migrate dev --name add_client_industry`
Expected: `prisma/migrations/<ts>_add_client_industry/migration.sql`이 생기고 내용은 `ALTER TABLE "Client" ADD COLUMN "industry" TEXT;`. dev DB에 적용되고 Prisma Client가 재생성됨. (로컬 PG 5433이 떠 있어야 함)

- [x] **Step 3: clientSchema에 industry 실패 테스트 작성**

`test/schemas.test.ts`의 `import` 문에 `clientSchema` 추가(`from "@/lib/validation/schemas"`), 파일 하단에 추가:

```typescript
describe("clientSchema industry", () => {
  it("maps empty string industry to null", () => {
    const r = clientSchema.safeParse({ name: "A사", industry: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.industry).toBeNull();
  });
  it("keeps a provided industry", () => {
    const r = clientSchema.safeParse({ name: "A사", industry: "제조" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.industry).toBe("제조");
  });
});
```

- [x] **Step 4: 테스트 실패 확인**

Run: `npm test -- schemas`
Expected: FAIL — `industry`가 스키마에 없어 `r.data.industry`가 undefined.

- [x] **Step 5: clientSchema에 industry 추가**

`src/lib/validation/schemas.ts`의 `clientSchema`에 `industry` 필드 추가:

```typescript
export const clientSchema = z.object({
  name: z.string().min(1),
  status: z.string().optional(),
  industry: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
  contractStart: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
  contractEnd: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
  pmId: z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional()),
});
```

- [x] **Step 6: 스키마 테스트 통과 확인**

Run: `npm test -- schemas`
Expected: PASS

- [x] **Step 7: 데이터 계층 industry 실패 테스트 작성**

`test/data-clients.test.ts` 하단(마지막 `it` 뒤, describe 안)에 추가:

```typescript
  it("creates and updates industry", async () => {
    const c = await createClient(ADMIN, { name: "A사", pmId: pmA, industry: "제조" });
    expect((await getClient(ADMIN, c.id))?.industry).toBe("제조");
    await updateClient(ADMIN, c.id, { name: "A사", industry: "IT" });
    expect((await getClient(ADMIN, c.id))?.industry).toBe("IT");
    await updateClient(ADMIN, c.id, { name: "A사", industry: null });
    expect((await getClient(ADMIN, c.id))?.industry).toBeNull();
  });
```

- [x] **Step 8: 테스트 실패 확인**

Run: `npm test -- data-clients`
Expected: FAIL — `ClientInput`에 industry가 없어 타입 에러 또는 저장 안 됨.

- [x] **Step 9: clients.ts에 industry 반영**

`src/lib/data/clients.ts`의 `ClientInput`에 `industry?: string | null;` 추가, `createClient`의 `data`에 `industry: input.industry ?? null,` 추가, `updateClient`의 `data`에 `industry: input.industry,` 추가:

```typescript
export type ClientInput = {
  name: string;
  status?: string;
  industry?: string | null;
  contractStart?: Date | null;
  contractEnd?: Date | null;
  pmId?: string | null;
};
```

createClient `data` 블록:

```typescript
      data: {
        name: input.name,
        status: input.status ?? "진행중",
        industry: input.industry ?? null,
        contractStart: input.contractStart ?? null,
        contractEnd: input.contractEnd ?? null,
        pmId: input.pmId ?? null,
      },
```

updateClient `data` 블록:

```typescript
      data: {
        name: input.name,
        status: input.status,
        industry: input.industry,
        contractStart: input.contractStart,
        contractEnd: input.contractEnd,
        pmId: input.pmId,
      },
```

- [x] **Step 10: 데이터 계층 테스트 통과 확인**

Run: `npm test -- data-clients`
Expected: PASS

- [x] **Step 11: 커밋**

```bash
cd /c/dev/roi-dashboard
git add prisma/schema.prisma prisma/migrations src/lib/validation/schemas.ts src/lib/data/clients.ts test/schemas.test.ts test/data-clients.test.ts
git commit -m "feat: add Client.industry field with validation and data layer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 업종 액션 연결 + 생성 폼 + 고객사 편집 화면

**Files:**
- Modify: `src/app/(app)/settings/clients/actions.ts:14-42` (두 액션에 industry)
- Modify: `src/app/(app)/settings/clients/NewClientForm.tsx` (업종 입력칸)
- Create: `src/app/(app)/settings/clients/[id]/EditClientForm.tsx`
- Modify: `src/app/(app)/settings/clients/[id]/page.tsx` (편집 폼 + PM 목록)

**Interfaces:**
- Consumes: Task 1의 `clientSchema.industry`, `updateClientAction`(이미 존재, id를 hidden으로 받음).
- Produces: `EditClientForm` 컴포넌트(props: `client`, `pms`).

_주: 이 태스크는 UI/서버액션이라 자동 단위 테스트가 없다. `npm run build`와 수동 확인으로 검증한다._

- [x] **Step 1: 두 액션이 industry를 읽도록 수정**

`src/app/(app)/settings/clients/actions.ts`의 `createClientAction`과 `updateClientAction` 둘 다 `clientSchema.safeParse({…})` 객체에 `industry: formData.get("industry"),`를 추가한다. 예(createClientAction):

```typescript
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    industry: formData.get("industry"),
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    pmId: formData.get("pmId"),
  });
```

updateClientAction의 `safeParse` 객체에도 동일하게 `industry: formData.get("industry"),` 한 줄 추가.

- [x] **Step 2: NewClientForm에 업종 입력칸 추가**

`src/app/(app)/settings/clients/NewClientForm.tsx`에서 "담당 PM" `<label>` 블록 바로 뒤에 추가:

```tsx
      <label className="flex flex-col text-xs text-[var(--color-muted)]">
        업종
        <input name="industry" className="mt-1 w-40 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
      </label>
```

- [x] **Step 3: EditClientForm 컴포넌트 생성**

`src/app/(app)/settings/clients/[id]/EditClientForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { updateClientAction } from "../actions";
import { OK } from "@/lib/action-state";

type Pm = { id: string; label: string };
type ClientInit = {
  id: string;
  name: string;
  status: string;
  pmId: string | null;
  industry: string | null;
  contractStart: string; // "yyyy-mm-dd" | ""
  contractEnd: string;
};

const labelCls = "flex flex-col text-xs text-[var(--color-muted)]";
const inputCls = "mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm";

export function EditClientForm({ client, pms }: { client: ClientInit; pms: Pm[] }) {
  const [state, formAction] = useActionState(updateClientAction, OK);
  return (
    <form action={formAction} className="mb-6 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <input type="hidden" name="id" value={client.id} />
      <label className={labelCls}>
        고객사명
        <input name="name" required defaultValue={client.name} className={`${inputCls} w-48`} />
      </label>
      <label className={labelCls}>
        상태
        <input name="status" defaultValue={client.status} className={`${inputCls} w-32`} />
      </label>
      <label className={labelCls}>
        담당 PM
        <select name="pmId" defaultValue={client.pmId ?? ""} className={`${inputCls} w-48`}>
          <option value="">미지정</option>
          {pms.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        업종
        <input name="industry" defaultValue={client.industry ?? ""} className={`${inputCls} w-40`} />
      </label>
      <label className={labelCls}>
        계약 시작
        <input type="date" name="contractStart" defaultValue={client.contractStart} className={inputCls} />
      </label>
      <label className={labelCls}>
        계약 종료
        <input type="date" name="contractEnd" defaultValue={client.contractEnd} className={inputCls} />
      </label>
      <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">저장</button>
      {state.ok && state.message && <span className="text-sm text-[var(--color-primary)]">{state.message}</span>}
      {!state.ok && state.error && <span className="text-sm text-[var(--color-danger)]">{state.error}</span>}
    </form>
  );
}
```

- [x] **Step 4: settings/clients/[id]/page.tsx에 편집 폼과 PM 목록 연결**

`src/app/(app)/settings/clients/[id]/page.tsx`를 아래로 교체:

```tsx
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { getClient } from "@/lib/data/clients";
import { listTasks } from "@/lib/data/tasks";
import { prisma } from "@/lib/db";
import { TaskManager } from "./TaskManager";
import { EditClientForm } from "./EditClientForm";

function toDateInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function SettingsClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const client = await getClient(ctx, id);
  if (!client) notFound();
  const [tasks, pms] = await Promise.all([
    listTasks(ctx, id),
    prisma.user.findMany({ where: { role: "PM", status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{client.name} — 고객사 정보·과업</h1>
      <EditClientForm
        client={{
          id: client.id,
          name: client.name,
          status: client.status,
          pmId: client.pmId,
          industry: client.industry,
          contractStart: toDateInput(client.contractStart),
          contractEnd: toDateInput(client.contractEnd),
        }}
        pms={pms.map((p) => ({ id: p.id, label: p.name ?? p.email }))}
      />
      <TaskManager
        clientId={id}
        tasks={tasks.map((t) => ({
          id: t.id,
          name: t.name,
          unitPrice: t.unitPrice,
          contractCount: t.contractCount,
          contractAmount: t.contractAmount,
        }))}
      />
    </div>
  );
}
```

- [x] **Step 5: 빌드로 타입·컴파일 검증**

Run: `npm run build`
Expected: 성공(에러 없음). `client.industry`, `client.pmId`, `client.contractStart` 등이 Prisma 타입에 존재.

- [x] **Step 6: 커밋**

```bash
cd /c/dev/roi-dashboard
git add "src/app/(app)/settings/clients"
git commit -m "feat: wire industry into client actions, add client edit form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 과업별 실적 월 매트릭스

**Files:**
- Modify: `src/lib/data/metrics.ts:183-270` (TaskPerf, ClientDetail, getClientDetail)
- Modify: `test/data-metrics.test.ts:133-159` (client detail 테스트)
- Modify: `src/app/(app)/clients/[id]/page.tsx` (과업별 실적 표 + 상단 합계)

**Interfaces:**
- Produces:
  - `type TaskMonthAmount = { month: number; amount: number }`
  - `type TaskPerf = { id: string; name: string; monthly: TaskMonthAmount[]; total: number }`
  - `ClientDetail`에 `contract: number` 추가.
  - `getClientDetail`의 `tasks`가 선택 기간의 월별 금액 배열을 반환.

- [x] **Step 1: client detail 테스트를 새 shape로 교체**

`test/data-metrics.test.ts`의 `it("returns detail with per-task period perf and 12 monthly rows", …)` 블록을 아래 두 테스트로 교체:

```typescript
  it("returns detail with per-task monthly amounts and contract total", async () => {
    const d = await getClientDetail(ADMIN, clientA, 2026, "all");
    expect(d).not.toBeNull();
    expect(d!.client.name).toBe("A사");
    expect(d!.contract).toBe(500000);
    const t = d!.tasks[0];
    expect(t.name).toBe("진단");
    expect(t.total).toBe(40000);
    expect(t.monthly).toHaveLength(12);
    expect(t.monthly.find((m) => m.month === 3)!.amount).toBe(40000);
    expect(t.monthly.find((m) => m.month === 1)!.amount).toBe(0);
    expect(d!.monthly).toHaveLength(12);
    expect(d!.monthly[2]).toEqual({ month: 3, performance: 40000, billing: 30000, deposit: 20000, expense: 0 });
  });

  it("task monthly columns follow the selected period (h1 → months 1..6)", async () => {
    const d = await getClientDetail(ADMIN, clientA, 2026, "h1");
    expect(d!.tasks[0].monthly.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(d!.tasks[0].total).toBe(40000);
  });
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm test -- data-metrics`
Expected: FAIL — `d!.contract`, `t.total`, `t.monthly` 미존재.

- [x] **Step 3: metrics.ts의 타입과 getClientDetail 수정**

`src/lib/data/metrics.ts`에서 `TaskPerf` 타입(183-190 부근)을 교체하고 `ClientDetail`에 `contract`를 추가:

```typescript
export type TaskMonthAmount = { month: number; amount: number };

export type TaskPerf = {
  id: string;
  name: string;
  monthly: TaskMonthAmount[];
  total: number;
};
```

```typescript
export type ClientDetail = {
  client: { id: string; name: string; status: string };
  contract: number;
  tasks: TaskPerf[];
  monthly: MonthlyRow[];
  expenses: ExpenseSlice[];
};
```

`getClientDetail` 내부에서 과업 집계 부분(현재 `const tasks = …`부터 `taskRows` 생성까지)을 아래로 교체:

```typescript
    const tasks = await tx.task.findMany({ where: { clientId: id }, orderBy: { name: "asc" } });
    const contract = tasks.reduce((s, t) => s + (t.contractAmount ?? 0), 0);
    const perfRows = await tx.monthlyPerformance.findMany({
      where: { year, month: monthRange, task: { clientId: id } },
      select: { taskId: true, month: true, amount: true },
    });
    const byTaskMonth = new Map<string, Map<number, number>>();
    for (const r of perfRows) {
      const m = byTaskMonth.get(r.taskId) ?? new Map<number, number>();
      m.set(r.month, (m.get(r.month) ?? 0) + r.amount);
      byTaskMonth.set(r.taskId, m);
    }
    const months = Array.from({ length: endMonth - startMonth + 1 }, (_, i) => startMonth + i);
    const taskRows: TaskPerf[] = tasks.map((t) => {
      const mm = byTaskMonth.get(t.id) ?? new Map<number, number>();
      const monthly = months.map((month) => ({ month, amount: mm.get(month) ?? 0 }));
      return { id: t.id, name: t.name, monthly, total: monthly.reduce((s, x) => s + x.amount, 0) };
    });
```

그리고 `return` 문에 `contract`를 추가:

```typescript
    return { client: { id: client.id, name: client.name, status: client.status }, contract, tasks: taskRows, monthly, expenses };
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npm test -- data-metrics`
Expected: PASS

- [x] **Step 5: clients/[id]/page.tsx의 상단 합계와 과업 표 수정**

`src/app/(app)/clients/[id]/page.tsx` 상단 import에 `resolvePeriod`를 추가한다(기존 `parsePeriodParams`와 같은 모듈):

```tsx
import { parsePeriodParams, resolvePeriod } from "@/lib/period";
```

31-32번째 줄의 `perf`/`contract` 계산을 교체:

```tsx
  const perf = detail.tasks.reduce((s, t) => s + t.total, 0);
  const contract = detail.contract;
```

그리고 `notFound()` 이후, `perf` 계산 근처에 월 목록을 추가:

```tsx
  const { startMonth, endMonth } = resolvePeriod(period);
  const months = Array.from({ length: endMonth - startMonth + 1 }, (_, i) => startMonth + i);
```

"과업별 실적 (선택 구간)" `<section>`(69-89줄) 전체를 매트릭스로 교체:

```tsx
      <section className="mb-8 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">과업별 월 실적 (선택 구간)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                <th className="py-2 pr-3">과업</th>
                {months.map((m) => (
                  <th key={m} className="px-2 text-right whitespace-nowrap">{m}월</th>
                ))}
                <th className="px-2 text-right">합계</th>
              </tr>
            </thead>
            <tbody>
              {detail.tasks.map((t) => (
                <tr key={t.id} className="border-b border-[var(--color-border)]">
                  <td className="py-2 pr-3 whitespace-nowrap">{t.name}</td>
                  {t.monthly.map((cell) => (
                    <td key={cell.month} className="px-2 text-right whitespace-nowrap">{formatWon(cell.amount)}</td>
                  ))}
                  <td className="px-2 text-right font-semibold whitespace-nowrap">{formatWon(t.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
```

- [x] **Step 6: 빌드 검증**

Run: `npm run build`
Expected: 성공. `t.total`/`t.monthly`/`detail.contract` 타입 일치.

- [x] **Step 7: 커밋**

```bash
cd /c/dev/roi-dashboard
git add src/lib/data/metrics.ts test/data-metrics.test.ts "src/app/(app)/clients/[id]/page.tsx"
git commit -m "feat: per-task monthly matrix on client detail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: getClientSummaries에 pmLabel·industry 추가

**Files:**
- Modify: `src/lib/data/metrics.ts:99-148` (ClientSummary, getClientSummaries)
- Modify: `test/data-metrics.test.ts` ("metrics: client & PM summaries" describe)

**Interfaces:**
- Consumes: Task 1의 `Client.industry`.
- Produces: `ClientSummary`에 `pmLabel: string`(null pmId → "미배정")과 `industry: string | null` 추가. `getPmSummaries`는 기존대로 `pmId`/`performance`/`expense`만 사용하므로 영향 없음.

- [x] **Step 1: summaries 테스트 추가(실패)**

`test/data-metrics.test.ts`의 `describe("metrics: client & PM summaries", …)` 안, `it("client summaries per client (ADMIN)", …)` 뒤에 추가:

```typescript
  it("client summaries include pmLabel", async () => {
    const rows = await getClientSummaries(ADMIN, 2026, "all");
    expect(rows.find((r) => r.name === "A사")!.pmLabel).toBe("PM A");
    expect(rows.find((r) => r.name === "B사")!.pmLabel).toBe("PM B");
  });

  it("client summary uses 미배정 for no PM and returns industry", async () => {
    await createClient(ADMIN, { name: "C사", industry: "제조" });
    const rows = await getClientSummaries(ADMIN, 2026, "all");
    const c = rows.find((r) => r.name === "C사")!;
    expect(c.pmLabel).toBe("미배정");
    expect(c.industry).toBe("제조");
  });
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm test -- data-metrics`
Expected: FAIL — `pmLabel`/`industry` 미존재.

- [x] **Step 3: ClientSummary 타입과 getClientSummaries 수정**

`src/lib/data/metrics.ts`의 `ClientSummary`에 두 필드 추가:

```typescript
export type ClientSummary = {
  id: string;
  name: string;
  pmId: string | null;
  pmLabel: string;
  industry: string | null;
  performance: number;
  expense: number;
  contract: number;
};
```

`getClientSummaries` 함수를 교체(내부는 기존 로직 유지 + industry 매핑, withRLS 결과를 받아 PM 이름 해석):

```typescript
export async function getClientSummaries(
  ctx: RlsContext,
  year: number,
  period: string,
): Promise<ClientSummary[]> {
  const { startMonth, endMonth } = resolvePeriod(period);
  const monthRange = { gte: startMonth, lte: endMonth };
  const base = await withRLS(ctx, async (tx) => {
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
      industry: c.industry,
      performance: perfByClient.get(c.id) ?? 0,
      expense: expByClient.get(c.id) ?? 0,
      contract: contractByClient.get(c.id) ?? 0,
    }));
  });

  const pmIds = [...new Set(base.map((c) => c.pmId).filter((x): x is string => x !== null))];
  const users = pmIds.length
    ? await prisma.user.findMany({ where: { id: { in: pmIds } } })
    : [];
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return base.map((c) => ({
    ...c,
    pmLabel: c.pmId === null ? "미배정" : labelById.get(c.pmId) ?? "(알 수 없음)",
  }));
}
```

_주: `resolvePeriod`, `prisma`, `withRLS`는 이미 이 파일에서 import되어 있음. `getPmSummaries`는 `getClientSummaries` 결과의 `pmId`/`performance`/`expense`만 쓰므로 그대로 동작._

- [x] **Step 4: 테스트 통과 확인(회귀 포함)**

Run: `npm test -- data-metrics`
Expected: PASS (기존 `getPmSummaries` 테스트 포함 전부 통과).

- [x] **Step 5: 커밋**

```bash
cd /c/dev/roi-dashboard
git add src/lib/data/metrics.ts test/data-metrics.test.ts
git commit -m "feat: expose pmLabel and industry from getClientSummaries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 검색/정렬/페이지네이션 순수 헬퍼

**Files:**
- Create: `src/lib/clients/summary-view.ts`
- Test: `test/client-summary-sort.test.ts`

**Interfaces:**
- Produces:
  - `type ClientRow = { id, name, pmLabel, industry, performance, expense, contract }` (구조상 `ClientSummary`와 호환)
  - `type SortMode = "name" | "pm" | "industry"`
  - `const PAGE_SIZE = 10`
  - `filterClients(rows, query): ClientRow[]`
  - `sortClients(rows, mode): ClientRow[]`
  - `paginate<T>(rows, page, size?): { pageRows: T[]; totalPages: number; page: number }`

- [x] **Step 1: 헬퍼 테스트 작성(실패)**

`test/client-summary-sort.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { filterClients, sortClients, paginate, type ClientRow } from "@/lib/clients/summary-view";

function row(name: string, pmLabel: string, industry: string | null): ClientRow {
  return { id: name, name, pmLabel, industry, performance: 0, expense: 0, contract: 0 };
}

const rows: ClientRow[] = [
  row("하늘", "박PM", "제조"),
  row("가람", "이PM", null),
  row("나무", "미배정", "IT"),
];

describe("filterClients", () => {
  it("filters by name substring, case-insensitive", () => {
    expect(filterClients(rows, "나").map((r) => r.name)).toEqual(["나무"]);
  });
  it("returns all rows for empty query", () => {
    expect(filterClients(rows, "  ").map((r) => r.name)).toEqual(["하늘", "가람", "나무"]);
  });
});

describe("sortClients", () => {
  it("sorts by name in Korean order", () => {
    expect(sortClients(rows, "name").map((r) => r.name)).toEqual(["가람", "나무", "하늘"]);
  });
  it("sorts by PM label, 미배정 last", () => {
    expect(sortClients(rows, "pm").map((r) => r.pmLabel)).toEqual(["박PM", "이PM", "미배정"]);
  });
  it("sorts by industry, null (미분류) last, tie-broken by name", () => {
    const r = sortClients(rows, "industry");
    expect(r.map((x) => x.industry)).toEqual(["IT", "제조", null]);
  });
  it("does not mutate the input array", () => {
    const before = rows.map((r) => r.name);
    sortClients(rows, "name");
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("paginate", () => {
  const many: ClientRow[] = Array.from({ length: 23 }, (_, i) => row(`c${i}`, "x", null));
  it("returns 10 per page and correct totalPages", () => {
    const p = paginate(many, 1);
    expect(p.pageRows).toHaveLength(10);
    expect(p.totalPages).toBe(3);
  });
  it("returns the remainder on the last page", () => {
    expect(paginate(many, 3).pageRows).toHaveLength(3);
  });
  it("clamps out-of-range page into range", () => {
    expect(paginate(many, 99).page).toBe(3);
    expect(paginate(many, 0).page).toBe(1);
  });
  it("has one page for an empty list", () => {
    const p = paginate([], 1);
    expect(p.totalPages).toBe(1);
    expect(p.pageRows).toEqual([]);
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm test -- client-summary-sort`
Expected: FAIL — 모듈 `@/lib/clients/summary-view` 없음.

- [x] **Step 3: 헬퍼 구현**

`src/lib/clients/summary-view.ts`:

```typescript
export type ClientRow = {
  id: string;
  name: string;
  pmLabel: string;
  industry: string | null;
  performance: number;
  expense: number;
  contract: number;
};

export type SortMode = "name" | "pm" | "industry";

export const PAGE_SIZE = 10;

export function filterClients(rows: ClientRow[], query: string): ClientRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}

function groupCmp(a: string | null, b: string | null, isUnassigned: (v: string | null) => boolean): number {
  const ua = isUnassigned(a);
  const ub = isUnassigned(b);
  if (ua !== ub) return ua ? 1 : -1; // 미배정/미분류는 뒤로
  if (ua && ub) return 0;
  return (a ?? "").localeCompare(b ?? "", "ko");
}

export function sortClients(rows: ClientRow[], mode: SortMode): ClientRow[] {
  const byName = (a: ClientRow, b: ClientRow) => a.name.localeCompare(b.name, "ko");
  const copy = [...rows];
  if (mode === "pm") {
    return copy.sort((a, b) => groupCmp(a.pmLabel, b.pmLabel, (v) => v === "미배정") || byName(a, b));
  }
  if (mode === "industry") {
    return copy.sort((a, b) => groupCmp(a.industry, b.industry, (v) => v === null || v.trim() === "") || byName(a, b));
  }
  return copy.sort(byName);
}

export function paginate<T>(rows: T[], page: number, size = PAGE_SIZE): { pageRows: T[]; totalPages: number; page: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const start = (clamped - 1) * size;
  return { pageRows: rows.slice(start, start + size), totalPages, page: clamped };
}
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npm test -- client-summary-sort`
Expected: PASS

- [x] **Step 5: 커밋**

```bash
cd /c/dev/roi-dashboard
git add src/lib/clients/summary-view.ts test/client-summary-sort.test.ts
git commit -m "feat: pure helpers for client summary search/sort/pagination

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ClientSummaryTable 컴포넌트 + 대시보드 연결

**Files:**
- Create: `src/components/dashboard/ClientSummaryTable.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx` (고객사별 요약 교체, 미사용 import 정리)

**Interfaces:**
- Consumes: Task 4의 `getClientSummaries` 결과(`ClientSummary[]`), Task 5의 `filterClients`/`sortClients`/`paginate`/`SortMode`/`ClientRow`.

- [x] **Step 1: ClientSummaryTable 컴포넌트 생성**

`src/components/dashboard/ClientSummaryTable.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { filterClients, sortClients, paginate, type ClientRow, type SortMode } from "@/lib/clients/summary-view";
import { margin, attainment } from "@/lib/metrics/formulas";
import { formatWon, formatPercent } from "@/lib/format";

const SORTS: { value: SortMode; label: string }[] = [
  { value: "name", label: "가나다순" },
  { value: "pm", label: "PM별" },
  { value: "industry", label: "업종별" },
];

export function ClientSummaryTable({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => sortClients(filterClients(clients, query), sort), [clients, query, sort]);
  const { pageRows, totalPages, page: current } = paginate(sorted, page);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="고객사명 검색"
          className="w-56 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
        />
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value as SortMode); setPage(1); }}
          className="rounded border border-[var(--color-border)] px-3 py-2 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <span className="text-xs text-[var(--color-muted)]">{sorted.length}개</span>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">고객사</th><th>PM</th><th>업종</th><th>실적</th><th>지출</th><th>수익률</th><th>달성률</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((c) => (
            <tr key={c.id} className="border-b border-[var(--color-border)]">
              <td className="py-2">
                <Link href={`/clients/${c.id}`} className="text-[var(--color-primary)]">{c.name}</Link>
              </td>
              <td>{c.pmLabel}</td>
              <td>{c.industry ?? "—"}</td>
              <td>{formatWon(c.performance)}</td>
              <td>{formatWon(c.expense)}</td>
              <td>{formatPercent(margin(c.performance, c.expense))}</td>
              <td>{formatPercent(attainment(c.performance, c.contract))}</td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr><td colSpan={7} className="py-4 text-center text-[var(--color-muted)]">결과 없음</td></tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            onClick={() => setPage(current - 1)}
            disabled={current <= 1}
            className="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-40"
          >이전</button>
          <span className="text-[var(--color-muted)]">{current} / {totalPages}</span>
          <button
            onClick={() => setPage(current + 1)}
            disabled={current >= totalPages}
            className="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-40"
          >다음</button>
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 2: 대시보드에서 고객사별 요약을 컴포넌트로 교체**

`src/app/(app)/dashboard/page.tsx`:

(a) import 추가:

```tsx
import { ClientSummaryTable } from "@/components/dashboard/ClientSummaryTable";
```

(b) 마지막 `<section>`(고객사별 요약, 106-128줄)의 `<table>…</table>` 전체를 컴포넌트로 교체:

```tsx
      <section className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">고객사별 요약</h2>
        <ClientSummaryTable clients={clients} />
      </section>
```

(c) 이제 `Link`는 이 파일에서 더 이상 쓰이지 않으므로 첫 줄 `import Link from "next/link";`를 삭제한다. (`margin`/`attainment`/`formatWon`/`formatPercent`는 KPI·PM표에서 계속 사용하므로 유지.)

- [x] **Step 3: 빌드 + 린트 검증**

Run: `npm run build`
Expected: 성공. 미사용 import 경고/에러 없음(Link 제거 확인). `clients`(ClientSummary[])가 `ClientSummaryTable`의 `ClientRow[]` prop에 구조적으로 대입 가능.

- [x] **Step 4: 전체 테스트 실행**

Run: `npm test`
Expected: 전부 PASS (기존 121개 + 신규 케이스).

- [x] **Step 5: 커밋**

```bash
cd /c/dev/roi-dashboard
git add src/components/dashboard/ClientSummaryTable.tsx "src/app/(app)/dashboard/page.tsx"
git commit -m "feat: search, sort toggle, and pagination on client summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 최종 검증

- [x] `npm test` 전체 통과
- [x] `npm run build` 성공
- [x] 수동 확인(선택): `npm run dev` 후
  - 설정>고객사>과업·단가 화면에서 고객사 정보 편집(업종 포함) 저장
  - 새 고객사 생성 시 업종 입력
  - 대시보드 고객사별 요약에서 검색/정렬 토글(가나다·PM별·업종별)/페이지 이동
  - 고객사 상세에서 과업별 월 매트릭스가 기간 필터(전체/상반기/단일월)에 따라 열이 바뀌는지
