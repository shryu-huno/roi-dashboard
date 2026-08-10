# 지급요청 공지사항 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/expenses` 지급요청 탭 상단의 자리표시자 배너(`PaymentRequestNoticeBanner`)를 실제 공지사항 CRUD로 교체한다 — ADMIN/SETTLEMENT가 배너 안에서 인라인으로 공지 1개를 작성/수정하고, PM을 포함한 전원이 읽을 수 있다.

**Architecture:** 공지는 고정 id(`"singleton"`) 단일 행만 갖는 새 Prisma 모델 `PaymentRequestNotice`로 저장한다(이력 없음, 항상 덮어쓰기). 기존 `PaymentRequest`와 동일한 RLS 패턴(SELECT는 전원 허용, INSERT/UPDATE는 ADMIN/SETTLEMENT만)을 건다. 데이터 계층 → zod 스키마 → 서버 액션 → client 컴포넌트로 이어지는 기존 지급요청 인라인 수정 스택(`updatePaymentRequest` / `paymentRequestUpdateSchema` / `updatePaymentRequestAction` / `PaymentRequestRow.tsx`)과 동일한 구조를 그대로 재사용한다.

**Tech Stack:** Next.js App Router(Server Actions), Prisma + PostgreSQL(Supabase, RLS), zod, Vitest.

## Global Constraints

- 공지는 항상 최대 1개(이력 없음, 새로 저장 시 덮어씀).
- 작성/수정 가능: ADMIN, SETTLEMENT만. PM은 읽기전용.
- 편집 UX는 배너 내 인라인(별도 모달 없음).
- 작성자/작성일시는 저장하지도 표시하지도 않는다.
- 내용을 빈 문자열로 저장하면 "공지 없음" 상태로 취급되어 기존 플레이스홀더 문구가 다시 보인다. 별도 삭제 기능 없음.
- 내용 길이 제한 없음.
- `npx prisma migrate dev`는 이 저장소에서 shadow DB 문제로 항상 깨진다 — 마이그레이션 SQL은 손으로 작성해 폴더에 배치하고 `npx prisma migrate deploy`로 적용한다(`npx prisma migrate dev` 절대 실행 금지).
- 스펙 문서: `docs/superpowers/specs/2026-08-05-payment-request-notice-design.md`

---

## Task 1: Prisma 모델 + 마이그레이션 + RLS

**Files:**
- Modify: `prisma/schema.prisma` (319번째 줄, `PaymentRequest` 모델 뒤 / `// --- Auth.js` 주석 앞에 삽입)
- Create: `prisma/migrations/20260805030000_add_payment_request_notice/migration.sql`

**Interfaces:**
- Produces: Prisma 모델 `PaymentRequestNotice { id, content, updatedAt }` — 이후 태스크가 `tx.paymentRequestNotice.findUnique(...)` / `tx.paymentRequestNotice.upsert(...)`로 사용.

- [ ] **Step 1: `prisma/schema.prisma`에 모델 추가**

`prisma/schema.prisma` 319번째 줄(`model PaymentRequest`의 닫는 `}` 바로 다음, `// --- Auth.js (NextAuth) 어댑터 모델 ---` 주석 바로 앞)에 삽입:

```prisma
// 지급요청 탭 상단 공지 배너. 항상 최대 1행("singleton")만 존재 — 새로 저장하면 덮어쓴다.
// 작성자/작성일시는 요구사항상 저장하지 않는다.
model PaymentRequestNotice {
  id        String   @id @default("singleton")
  content   String   @default("")
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: 마이그레이션 SQL 작성**

디렉터리 `prisma/migrations/20260805030000_add_payment_request_notice/`를 만들고 그 안에 `migration.sql`을 다음 내용으로 작성한다(기존 `PaymentRequest` 테이블의 `payment_request_write_admin` 정책과 동일한 형태):

```sql
-- CreateTable
CREATE TABLE "PaymentRequestNotice" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "content" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequestNotice_pkey" PRIMARY KEY ("id")
);

-- RLS: SELECT는 전원 허용(지급요청 탭 자체가 ADMIN/SETTLEMENT/PM 전용이라 별도 스코프 불필요).
-- INSERT/UPDATE는 ADMIN/SETTLEMENT만(PaymentRequest의 payment_request_write_admin과 동일 패턴).
-- DELETE 정책 없음 — 항상 upsert로 빈 문자열까지 포함해 갱신한다.
ALTER TABLE "PaymentRequestNotice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRequestNotice" FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_request_notice_select ON "PaymentRequestNotice"
  FOR SELECT
  USING (true);

CREATE POLICY payment_request_notice_write_admin ON "PaymentRequestNotice"
  FOR ALL
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'))
  WITH CHECK (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT'));
```

- [ ] **Step 3: 마이그레이션 적용 + 검증**

Run: `npx prisma migrate deploy`
Expected: `20260805030000_add_payment_request_notice` 적용 성공 로그.

Run: `npx prisma migrate status`
Expected: `Database schema is up to date!`

Run: `npx prisma generate`
Expected: 성공(에러 없음) — 이후 태스크에서 `prisma.paymentRequestNotice` 타입을 쓰기 위해 필요.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260805030000_add_payment_request_notice
git commit -m "feat(payment-request): 공지사항 테이블 + RLS 추가"
```

---

## Task 2: 데이터 계층 (`payment-request-notice.ts`)

**Files:**
- Create: `src/lib/data/payment-request-notice.ts`
- Test: `test/data-payment-request-notice.test.ts`

**Interfaces:**
- Consumes: `withRLS`/`RlsContext`(`@/lib/rls`, Task 1의 `PaymentRequestNotice` Prisma 모델).
- Produces:
  - `getPaymentRequestNotice(ctx: RlsContext): Promise<string>`
  - `upsertPaymentRequestNotice(ctx: RlsContext, content: string): Promise<ActionState>`
  - 다음 태스크(서버 액션)가 이 두 함수를 그대로 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-request-notice.test.ts` 새로 작성:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import { getPaymentRequestNotice, upsertPaymentRequestNotice } from "@/lib/data/payment-request-notice";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };
const SETTLEMENT = { userId: "seed-settlement", role: "SETTLEMENT" as const };
const PM = { userId: "seed-pm", role: "PM" as const };

async function reset() {
  await withRLS(ADMIN, (tx) => tx.paymentRequestNotice.deleteMany());
}

describe("payment-request-notice 데이터 계층", () => {
  beforeEach(reset);

  it("공지가 없으면 빈 문자열을 반환한다", async () => {
    const content = await getPaymentRequestNotice(ADMIN);
    expect(content).toBe("");
  });

  it("SETTLEMENT가 저장하면 반영되고, 다시 조회하면 그대로 나온다", async () => {
    const result = await upsertPaymentRequestNotice(SETTLEMENT, "정산 마감 안내드립니다.");
    expect(result.ok).toBe(true);
    const content = await getPaymentRequestNotice(ADMIN);
    expect(content).toBe("정산 마감 안내드립니다.");
  });

  it("같은 내용을 다시 저장하면 기존 공지를 덮어쓴다(행은 여전히 1개)", async () => {
    await upsertPaymentRequestNotice(ADMIN, "1차 공지");
    await upsertPaymentRequestNotice(ADMIN, "2차 공지");
    const content = await getPaymentRequestNotice(ADMIN);
    expect(content).toBe("2차 공지");
    const rows = await withRLS(ADMIN, (tx) => tx.paymentRequestNotice.findMany());
    expect(rows.length).toBe(1);
  });

  it("빈 문자열로 저장하면 공지가 비워진다", async () => {
    await upsertPaymentRequestNotice(ADMIN, "지울 공지");
    await upsertPaymentRequestNotice(ADMIN, "");
    const content = await getPaymentRequestNotice(ADMIN);
    expect(content).toBe("");
  });

  it("PM은 조회할 수 있다", async () => {
    await upsertPaymentRequestNotice(ADMIN, "PM도 볼 수 있는 공지");
    const content = await getPaymentRequestNotice(PM);
    expect(content).toBe("PM도 볼 수 있는 공지");
  });

  it("PM은 저장할 수 없다(RLS 거부)", async () => {
    await expect(upsertPaymentRequestNotice(PM, "PM이 쓰려는 공지")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/data-payment-request-notice.test.ts`
Expected: FAIL — `Cannot find module '@/lib/data/payment-request-notice'` (아직 파일이 없음).

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payment-request-notice.ts` 새로 작성:

```ts
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";

const NOTICE_ID = "singleton";

export async function getPaymentRequestNotice(ctx: RlsContext): Promise<string> {
  return withRLS(ctx, async (tx) => {
    const row = await tx.paymentRequestNotice.findUnique({ where: { id: NOTICE_ID } });
    return row?.content ?? "";
  });
}

export async function upsertPaymentRequestNotice(ctx: RlsContext, content: string): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    await tx.paymentRequestNotice.upsert({
      where: { id: NOTICE_ID },
      update: { content },
      create: { id: NOTICE_ID, content },
    });
    return { ok: true };
  });
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/data-payment-request-notice.test.ts`
Expected: PASS (6개 테스트 모두 통과).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/payment-request-notice.ts test/data-payment-request-notice.test.ts
git commit -m "feat(payment-request): 공지사항 데이터 계층 추가"
```

---

## Task 3: 검증 스키마 (`paymentRequestNoticeSchema`)

**Files:**
- Modify: `src/lib/validation/schemas.ts` (211번째 줄, `paymentRequestBulkUpdateSchema` 뒤에 추가)
- Test: `test/schemas.test.ts`

**Interfaces:**
- Produces: `paymentRequestNoticeSchema: ZodObject<{ content: ZodString }>` — Task 4(서버 액션)가 `paymentRequestNoticeSchema.safeParse(...)`로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/schemas.test.ts` 상단 import 목록(`paymentRequestBulkUpdateSchema` 다음)에 `paymentRequestNoticeSchema`를 추가하고, 파일 맨 끝(`describe("paymentRequestUploadRowSchema", ...)` 블록 뒤)에 새 블록을 추가:

```ts
describe("paymentRequestNoticeSchema", () => {
  it("일반 문자열을 그대로 허용한다", () => {
    const r = paymentRequestNoticeSchema.safeParse({ content: "정산 마감 안내드립니다." });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content).toBe("정산 마감 안내드립니다.");
  });

  it("앞뒤 공백은 trim한다", () => {
    const r = paymentRequestNoticeSchema.safeParse({ content: "  공지 내용  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content).toBe("공지 내용");
  });

  it("공백만 있으면 빈 문자열로 통과한다(공지 비우기)", () => {
    const r = paymentRequestNoticeSchema.safeParse({ content: "   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content).toBe("");
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: FAIL — `paymentRequestNoticeSchema` is not exported from `@/lib/validation/schemas`.

- [ ] **Step 3: 스키마 추가**

`src/lib/validation/schemas.ts` 211번째 줄(`paymentRequestBulkUpdateSchema` 정의 뒤)에 추가:

```ts
// 지급요청 공지 배너 — 항상 최대 1개, trim 후 빈 문자열이면 공지 없음 상태로 저장된다.
export const paymentRequestNoticeSchema = z.object({
  content: z.string().trim(),
});
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: PASS (기존 케이스 포함 전부 통과).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/schemas.ts test/schemas.test.ts
git commit -m "feat(payment-request): 공지사항 검증 스키마 추가"
```

---

## Task 4: 서버 액션 (`updatePaymentRequestNoticeAction`)

**Files:**
- Modify: `src/app/(app)/expenses/payment-request/actions.ts`

**Interfaces:**
- Consumes: `getPaymentRequestNotice`/`upsertPaymentRequestNotice`(Task 2), `paymentRequestNoticeSchema`(Task 3), `requireRole`(`@/lib/auth/session`, 기존), `getRlsContext`(`@/lib/context`, 기존), `SAVED`/`ActionState`(`@/lib/action-state`, 기존).
- Produces: `updatePaymentRequestNoticeAction(formData: FormData): Promise<ActionState>` — Task 5(UI)가 클라이언트 컴포넌트에서 그대로 import해 호출한다.

이 태스크는 서버 액션 하나만 추가하는 순수 배선 작업이라 별도 유닛 테스트 없이 Task 2에서 이미 검증한 데이터 계층 + Task 5의 브라우저 확인으로 갈음한다(기존 코드베이스 컨벤션 — `updatePaymentRequestAction` 등도 별도 액션 단위 테스트 없음).

- [ ] **Step 1: import 추가**

`src/app/(app)/expenses/payment-request/actions.ts` 상단 import 블록을 수정:

```ts
import {
  updatePaymentRequestsBulk, updatePaymentRequest, updatePaymentRequestPmFields,
  updatePaymentRequestsByIds, softDeletePaymentRequests, createPaymentRequestsFromUpload,
} from "@/lib/data/payment-requests";
import { upsertPaymentRequestNotice } from "@/lib/data/payment-request-notice";
```

그리고 스키마 import 블록에 `paymentRequestNoticeSchema` 추가:

```ts
import {
  paymentRequestUpdateSchema, paymentRequestUpdatePmSchema, paymentRequestBulkUpdateSchema,
  paymentRequestNoticeSchema,
} from "@/lib/validation/schemas";
```

- [ ] **Step 2: 액션 함수 추가**

`updatePaymentRequestAction` 정의 바로 뒤(98번째 줄 근처)에 추가:

```ts
export async function updatePaymentRequestNoticeAction(formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const parsed = paymentRequestNoticeSchema.safeParse({ content: formData.get("content") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };

  try {
    const result = await upsertPaymentRequestNotice(ctx, parsed.data.content);
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request notice] 저장 실패:", e);
    return { ok: false, error: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}
```

- [ ] **Step 3: 타입체크로 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음(새 액션과 import가 타입상 문제 없이 연결됨).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/expenses/payment-request/actions.ts"
git commit -m "feat(payment-request): 공지사항 저장 서버 액션 추가"
```

---

## Task 5: `PaymentRequestNoticeBanner` — 인라인 편집 UI

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx`

**Interfaces:**
- Consumes: `updatePaymentRequestNoticeAction`(Task 4).
- Produces: `PaymentRequestNoticeBanner({ content, canEdit }: { content: string; canEdit: boolean })` — Task 6(`PaymentRequestListPanel`)이 이 props로 렌더링한다.

이 컴포넌트는 순수 UI라 자동 테스트가 없다(코드베이스에 `.tsx` 단위테스트 없음, `PaymentRequestRow.tsx` 등 기존 인라인 편집 컴포넌트들도 동일). Task 6까지 마친 뒤 브라우저에서 함께 확인한다.

- [ ] **Step 1: 컴포넌트 전체 교체**

`src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx` 전체를 다음으로 교체(`PaymentRequestRow.tsx`의 `useState`+`useTransition`+`router.refresh()` 패턴과 동일한 구조):

```tsx
// src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePaymentRequestNoticeAction } from "./payment-request/actions";

export function PaymentRequestNoticeBanner({
  content,
  canEdit,
}: {
  content: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleStartEdit() {
    setDraft(content);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setDraft(content);
    setError(null);
    setEditing(false);
  }

  function handleSave() {
    const formData = new FormData();
    formData.set("content", draft);

    setError(null);
    startTransition(async () => {
      const result = await updatePaymentRequestNoticeAction(formData);
      if (result.ok) {
        router.refresh();
        setEditing(false);
      } else {
        setError(result.error ?? "저장 중 오류가 발생했습니다.");
      }
    });
  }

  if (editing) {
    return (
      <div className="mb-4 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] px-4 py-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-primary)] focus:outline-none"
          placeholder="공지 내용을 입력하세요."
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-[var(--color-danger)]">{error}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="rounded bg-[var(--color-success)] px-3 py-1.5 text-xs text-white disabled:opacity-60"
          >
            {pending ? "저장 중..." : "저장"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] px-4 py-3 text-sm text-[var(--color-muted)]">
      <p className="whitespace-pre-wrap">{content || "📢 등록된 공지가 없습니다."}</p>
      {canEdit && (
        <button
          type="button"
          onClick={handleStartEdit}
          className="shrink-0 whitespace-nowrap text-[var(--color-muted)] hover:text-[var(--color-primary)]"
          aria-label="공지 수정"
        >
          ✏️ 수정
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크로 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음(이 시점에는 `PaymentRequestListPanel`이 아직 옛날 방식으로 `<PaymentRequestNoticeBanner />`를 props 없이 호출 중이라 여기서 타입 에러가 나는 게 정상 — Task 6에서 호출부를 고치면 해소된다). 에러 메시지가 `PaymentRequestListPanel.tsx`에서 `content`/`canEdit` 누락을 가리키는지 확인한다.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/expenses/PaymentRequestNoticeBanner.tsx"
git commit -m "feat(payment-request): 공지 배너 인라인 편집 UI 구현"
```

---

## Task 6: 데이터 흐름 배선 (`page.tsx` → `ListPanel` → `Banner`) + 브라우저 확인

**Files:**
- Modify: `src/app/(app)/expenses/page.tsx`
- Modify: `src/app/(app)/expenses/PaymentRequestListPanel.tsx`

**Interfaces:**
- Consumes: `getPaymentRequestNotice`(Task 2), `PaymentRequestNoticeBanner`(Task 5의 `{ content, canEdit }` props).

- [ ] **Step 1: `page.tsx`에서 공지 조회 + prop 전달**

`src/app/(app)/expenses/page.tsx` 상단 import에 추가:

```ts
import { getPaymentRequestNotice } from "@/lib/data/payment-request-notice";
```

`PaymentRequestTab` 함수 본문(228-229번째 줄)을 수정:

```ts
  const ctx = getRlsContext(user);
  const [clients, payees, noticeContent] = await Promise.all([
    listClients(ctx), listPayeeOptions(ctx), getPaymentRequestNotice(ctx),
  ]);
  const bizNames = Array.from(new Set(payees.map((p) => p.bizName))).sort();
```

그리고 `<PaymentRequestListPanel ... />` 호출부(244-261번째 줄)의 `payees={payees}` 다음 줄에 추가:

```tsx
      noticeContent={noticeContent}
```

- [ ] **Step 2: `PaymentRequestListPanel`이 prop을 받아 배너로 전달**

`src/app/(app)/expenses/PaymentRequestListPanel.tsx`의 props 타입 정의(40-59번째 줄)에 `noticeContent: string;`을 `payees` 다음 줄에 추가하고, 구조분해 매개변수 목록에도 `noticeContent`를 추가:

```ts
export function PaymentRequestListPanel({
  rows,
  page,
  totalPages,
  clients,
  payees,
  bizNames,
  filterValues,
  role,
  currentUserId,
  noticeContent,
}: {
  rows: PaymentRequestRowData[];
  page: number;
  totalPages: number;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  bizNames: string[];
  filterValues: FilterValues;
  role: AppRole;
  currentUserId: string;
  noticeContent: string;
}) {
```

143번째 줄의 배너 렌더링을 수정:

```tsx
      <PaymentRequestNoticeBanner content={noticeContent} canEdit={role === "ADMIN" || role === "SETTLEMENT"} />
```

- [ ] **Step 3: 타입체크로 전체 배선 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음(Task 5에서 남아있던 props 불일치가 여기서 해소됨).

- [ ] **Step 4: 전체 테스트 스위트 실행**

Run: `npx vitest run`
Expected: 전체 PASS(회귀 없음).

- [ ] **Step 5: 개발 서버로 브라우저 확인**

Run: `npm run dev`

브라우저에서 `/expenses?tab=payment-request`로 이동해 각 역할별로 확인한다(로컬 로그인 사용자를 ADMIN/SETTLEMENT/PM으로 바꿔가며, 또는 DB에서 테스트 계정 role 조회):
1. 공지가 없는 초기 상태: "📢 등록된 공지가 없습니다." 표시 확인.
2. ADMIN 또는 SETTLEMENT 계정: 배너에 "✏️ 수정" 버튼이 보이는지 확인. 클릭 → textarea로 전환되는지 확인.
3. 아무 문구나 입력 후 "저장" 클릭 → 배너가 보기 모드로 돌아오며 입력한 문구가 표시되는지 확인.
4. 페이지를 새로고침(F5)해도 문구가 유지되는지 확인(DB 반영 확인).
5. 다시 "✏️ 수정" → 내용을 지우고 "저장" → "📢 등록된 공지가 없습니다."로 돌아오는지 확인.
6. PM 계정으로 같은 화면 접속 → 저장된 공지는 보이되 "✏️ 수정" 버튼이 없는지 확인.

Expected: 위 6가지 모두 설명대로 동작.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/expenses/page.tsx" "src/app/(app)/expenses/PaymentRequestListPanel.tsx"
git commit -m "feat(payment-request): 공지 배너 데이터 흐름 연결"
```

---

## 최종 확인

- [ ] `npx vitest run` 전체 통과
- [ ] `npx tsc --noEmit` 에러 없음
- [ ] `npx prisma migrate status` → "Database schema is up to date!"
- [ ] Task 6 Step 5의 브라우저 시나리오 전부 확인 완료
