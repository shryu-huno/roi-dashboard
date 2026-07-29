# 지급리스트 삭제(소프트 삭제) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지급리스트(payees) 화면에서 체크박스로 개별/다수 항목을 선택해 확인 모달을 거쳐 소프트 삭제할 수 있게 한다.

**Architecture:** `Payee`에 `deletedAt` 컬럼을 추가해 소프트 삭제하고, 목록 조회 쿼리에서 `deletedAt: null` 필터로 제외한다. 데이터 계층에 `softDeletePayees(ctx, ids)` 하나로 개별/일괄 삭제를 모두 처리하고, 서버 액션 `deletePayeesAction`을 거쳐 클라이언트에서 호출한다. UI는 `PayeeListPanel`이 삭제 대상(id 배열)과 확인 모달 상태를 소유하고, `PayeeRow`는 삭제 버튼 클릭을 부모로 위임한다(첨부파일 모달과 동일한 패턴 — `<tr>` 내부에 `fixed` 오버레이 모달을 직접 두면 유효하지 않은 테이블 DOM 구조가 되므로 개별 삭제 확인 모달도 행이 아닌 패널이 소유한다. 스펙 문서의 "행 내부 로컬 상태" 표현을 이 이유로 조정했다).

**Tech Stack:** Next.js App Router (서버 액션), Prisma + PostgreSQL, Vitest.

## Global Constraints

- 삭제 권한: SETTLEMENT/ADMIN만 (요구사항 그대로, `updatePayee`/`requireRole("SETTLEMENT")`와 동일).
- 소프트 삭제만 한다. DB row·첨부파일·스토리지 파일은 지우지 않는다.
- 삭제 확인 모달 문구: `"{count}건을 삭제하시겠습니까?\n삭제된 항목은 목록에서 숨겨집니다."`
- "찾을 수 없음" 에러 문구: `"삭제할 항목을 찾을 수 없습니다."`
- 액션 레벨 일반 에러 문구: `"삭제 중 오류가 발생했습니다. 잠시 후 다시 시도하세요."`
- 권한 없음 에러 문구(데이터 계층에서 throw): `"지급 리스트 삭제 권한이 없습니다."`
- 보관함/복원 UI는 만들지 않는다(스펙의 범위 제외 항목).

---

## Task 1: 스키마에 `deletedAt` 추가 + 목록 조회에서 소프트 삭제 행 제외

**Files:**
- Modify: `prisma/schema.prisma:217-239` (Payee 모델)
- Create: `prisma/migrations/20260729090000_add_payee_deleted_at/migration.sql`
- Modify: `src/lib/data/payees.ts:142-162` (`fetchMatchedPayees`)
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Produces: `Payee.deletedAt: Date | null` (Prisma Client 필드), `listPayees`/`listPayeesForExport`는 이제 소프트 삭제된 행을 반환하지 않음(기존 함수 시그니처는 변경 없음).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payees.test.ts`의 `updatePayee` 관련 테스트 블록들 바로 아래(파일 끝, `});` 닫는 괄호 앞)에 추가:

```ts
  it("listPayees와 listPayeesForExport는 소프트 삭제된 행을 제외한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    await withRLS(ADMIN, (tx) =>
      tx.payee.update({ where: { id: row.id }, data: { deletedAt: new Date() } }),
    );

    expect(await listPayees(ADMIN)).toHaveLength(0);
    expect(await listPayeesForExport(ADMIN)).toHaveLength(0);
  });
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run test/data-payees.test.ts -t "소프트 삭제된 행을 제외"`
Expected: FAIL — Prisma가 `deletedAt`을 알 수 없는 인자로 거부 (`Unknown argument 'deletedAt'`).

- [ ] **Step 3: 스키마에 필드 추가**

`prisma/schema.prisma`의 Payee 모델(217번 줄 근처) — `updatedAt` 필드 다음 줄에 추가:

```prisma
model Payee {
  id                  String    @id @default(cuid())
  keyId               String    @unique // 표시 고유번호 a001/b001 (앱이 시퀀스로 채번)
  payeeType           PayeeType          // 강사/업체 (번호 길이로 파생)
  bizName             String             // 사업자명/이름
  bizNumberEnc        String             // 사업자번호/주민번호 AES-GCM 암호문
  bizNumberMasked     String             // 마스킹 표시값 (900101-1****** / 123-45-6****)
  bizNumberBidx       String    @unique  // HMAC 블라인드 인덱스 (정확일치 검색 + 중복 방지)
  phone               String             // 강사·업체 공통 연락처
  phoneNormalized     String             // 하이픈 제거 검색용 (앱이 채움)
  bankName            String
  accountNumberEnc    String             // 계좌번호 AES-GCM 암호문
  accountNumberMasked String             // ****1234
  accountHolder       String             // 예금주
  taxType             TaxType            // 청구방식
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  deletedAt           DateTime?          // 소프트 삭제. null=활성, 값=삭제됨(목록에서 숨김).

  attachments         PayeeAttachment[]

  @@index([phoneNormalized])
  @@index([payeeType])
}
```

- [ ] **Step 4: 마이그레이션 파일 생성**

`prisma/migrations/20260729090000_add_payee_deleted_at/migration.sql` 생성:

```sql
-- 지급 대상 소프트 삭제: null=활성, 값=삭제됨(목록에서 숨김)
ALTER TABLE "Payee" ADD COLUMN     "deletedAt" TIMESTAMP(3);
```

- [ ] **Step 5: Prisma Client 재생성**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` 성공 로그. (테스트 실행 시 `test/global-setup.ts`가 `prisma migrate deploy`로 테스트 DB에 마이그레이션을 자동 적용하므로 DB 스키마 반영은 별도 수동 작업 불필요.)

- [ ] **Step 6: `fetchMatchedPayees` 조회 조건에 필터 추가**

`src/lib/data/payees.ts:142-162`:

```ts
// listPayees/listPayeesForExport 공통: role 체크 + 조회 + 인메모리 검색 필터링.
function fetchMatchedPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<MatchedPayee[]> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  return withRLS(ctx, async (tx) => {
    const rows = await tx.payee.findMany({
      where: { deletedAt: null },
      orderBy: { keyId: "asc" },
      include: { attachments: { select: { fileType: true } } },
    });
    const q = filter?.q.trim();
    if (!filter || !q) return rows;
    return rows.filter((r) => {
      if (filter.field === "bizName") return r.bizName.toLowerCase().includes(q.toLowerCase());
      if (filter.field === "keyId") return r.keyId.toLowerCase().includes(q.toLowerCase());
      const qDigits = digitsOnly(q).slice(0, 6);
      return digitsOnly(decrypt(r.bizNumberEnc)).includes(qDigits);
    });
  });
}
```

(변경은 `where: { deletedAt: null }` 한 줄 추가뿐 — 나머지는 그대로.)

- [ ] **Step 7: 테스트 재실행 → 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS (전체 `data-payees.test.ts` 스위트, 신규 테스트 포함).

- [ ] **Step 8: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations/20260729090000_add_payee_deleted_at src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payees): Payee에 소프트 삭제용 deletedAt 필드 추가"
```

---

## Task 2: `softDeletePayees` 데이터 함수

**Files:**
- Modify: `src/lib/data/payees.ts` (import 구문 + 파일 끝에 함수 추가)
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Consumes: `RlsContext`(기존), `ActionState`(from `@/lib/action-state`).
- Produces: `softDeletePayees(ctx: RlsContext, ids: string[]): Promise<ActionState>` — Task 3(서버 액션)이 그대로 호출.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payees.test.ts` 상단 import에 `softDeletePayees` 추가:

```ts
import {
  createPayeesBulk, listPayees, listPayeesForExport, findPayeeByBizNumber, parsePayeeSearchField,
  updatePayee, softDeletePayees,
  type PayeeCreateInput,
} from "@/lib/data/payees";
```

파일 끝(`describe` 블록의 마지막 `it` 다음)에 테스트 추가:

```ts
  it("softDeletePayees: deletedAt을 채우고 listPayees에서 제외한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    const res = await softDeletePayees(ADMIN, [row.id]);
    expect(res.ok).toBe(true);

    expect(await listPayees(ADMIN)).toHaveLength(0);
    const raw = await withRLS(ADMIN, (tx) => tx.payee.findUnique({ where: { id: row.id } }));
    expect(raw?.deletedAt).not.toBeNull();
  });

  it("softDeletePayees: 여러 id를 한 번에 삭제한다(일괄 삭제)", async () => {
    await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR"),
      input("9002022345678", "INSTRUCTOR"),
    ]);
    const rows = await listPayees(ADMIN);

    const res = await softDeletePayees(ADMIN, rows.map((r) => r.id));
    expect(res.ok).toBe(true);
    expect(await listPayees(ADMIN)).toHaveLength(0);
  });

  it("softDeletePayees: 이미 삭제된 항목을 다시 삭제하면 ok:false", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    expect((await softDeletePayees(ADMIN, [row.id])).ok).toBe(true);
    const res2 = await softDeletePayees(ADMIN, [row.id]);
    expect(res2.ok).toBe(false);
    expect(res2.error).toBe("삭제할 항목을 찾을 수 없습니다.");
  });

  it("softDeletePayees는 SETTLEMENT/ADMIN 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    await expect(
      softDeletePayees({ userId: "pm1", role: "PM" }, [row.id]),
    ).rejects.toThrow("지급 리스트 삭제 권한이 없습니다.");
  });
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run test/data-payees.test.ts -t "softDeletePayees"`
Expected: FAIL — `softDeletePayees` is not exported / not a function.

- [ ] **Step 3: 함수 구현**

`src/lib/data/payees.ts` 상단 import에 `ActionState` 타입 추가:

```ts
import type { Payee, PayeeType, TaxType, Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { decrypt, encrypt, blindIndex, digitsOnly, maskAccountNumber } from "@/lib/crypto/payee-secret";
import type { ActionState } from "@/lib/action-state";
```

파일 끝(`updatePayee` 함수 다음)에 추가:

```ts
// 지급 리스트 소프트 삭제 — 개별/일괄 모두 이 함수 하나로 처리(ids 길이 1 또는 N).
// 이미 삭제됐거나 존재하지 않는 id가 섞여도 나머지는 정상 삭제되고, count가 0일 때만 실패로 본다.
export function softDeletePayees(ctx: RlsContext, ids: string[]): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
      throw new Error("지급 리스트 삭제 권한이 없습니다.");
    }
    const result = await tx.payee.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) return { ok: false, error: "삭제할 항목을 찾을 수 없습니다." };
    return { ok: true };
  });
}
```

- [ ] **Step 4: 테스트 재실행 → 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS (전체 스위트).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payees): softDeletePayees 데이터 함수 추가"
```

---

## Task 3: `deletePayeesAction` 서버 액션

**Files:**
- Modify: `src/app/(app)/expenses/payees/actions.ts`

**Interfaces:**
- Consumes: `softDeletePayees(ctx, ids)` (Task 2), `requireRole`/`getRlsContext`(기존 패턴, `updatePayeeAction` 참고).
- Produces: `deletePayeesAction(ids: string[]): Promise<ActionState>` — Task 5·6(클라이언트 컴포넌트)이 호출.

> 이 파일의 다른 서버 액션(`uploadPayeesAction`, `updatePayeeAction`)도 세션 의존적이라 자동화 테스트가 없다(`test/` 디렉터리에 액션 테스트 없음, 데이터 계층만 테스트). 이 태스크도 동일 컨벤션을 따라 자동 테스트 없이 진행하고, Task 5에서 UI로 연결한 뒤 브라우저로 동작을 확인한다.

- [ ] **Step 1: import 및 함수 추가**

`src/app/(app)/expenses/payees/actions.ts` 상단 import 수정:

```ts
import { createPayeesBulk, updatePayee, softDeletePayees } from "@/lib/data/payees";
```

파일 끝(`updatePayeeAction` 다음)에 추가:

```ts
export async function deletePayeesAction(ids: string[]): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  let result: ActionState;
  try {
    result = await softDeletePayees(ctx, ids);
  } catch (e) {
    console.error("[payee delete] 삭제 실패:", e);
    return { ok: false, error: "삭제 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }
  if (!result.ok) return result;

  revalidatePath("/expenses");
  return result;
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/\(app\)/expenses/payees/actions.ts
git commit -m "feat(payees): 지급리스트 삭제 서버 액션 추가"
```

---

## Task 4: 삭제 확인 모달 컴포넌트

**Files:**
- Create: `src/app/(app)/expenses/PayeeDeleteConfirmModal.tsx`

**Interfaces:**
- Produces: `PayeeDeleteConfirmModal` 컴포넌트, props `{ open: boolean; count: number; pending: boolean; error: string | null; onConfirm: () => void; onCancel: () => void }` — Task 6(`PayeeListPanel`)이 렌더링.

- [ ] **Step 1: 컴포넌트 작성**

`src/app/(app)/expenses/PayeeDeleteConfirmModal.tsx` 신규 생성 (스타일은 `PayeeAttachmentModal.tsx`의 오버레이 컨벤션과 동일):

```tsx
"use client";

export function PayeeDeleteConfirmModal({
  open,
  count,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  count: number;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-semibold">삭제 확인</h2>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          {count}건을 삭제하시겠습니까?<br />
          삭제된 항목은 목록에서 숨겨집니다.
        </p>
        {error && <p className="mb-4 text-sm text-[var(--color-danger)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded bg-[var(--color-danger)] px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {pending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/\(app\)/expenses/PayeeDeleteConfirmModal.tsx
git commit -m "feat(payees): 삭제 확인 모달 컴포넌트 추가"
```

---

## Task 5: 개별 삭제 — 행 버튼 + 패널 상태 연결

**Files:**
- Modify: `src/app/(app)/expenses/PayeeRow.tsx`
- Modify: `src/app/(app)/expenses/PayeeListPanel.tsx`

**Interfaces:**
- Consumes: `deletePayeesAction`(Task 3), `PayeeDeleteConfirmModal`(Task 4).
- Produces: `PayeeRow`에 `onRequestDelete: () => void` prop 추가(Task 6에서 그대로 재사용). `PayeeListPanel`에 `deleteTarget: string[] | null` 상태 추가(Task 6의 일괄 삭제 버튼이 같은 상태를 재사용).

- [ ] **Step 1: `PayeeRow.tsx`에 삭제 버튼 추가**

`src/app/(app)/expenses/PayeeRow.tsx`의 props 타입과 함수 시그니처(50-66번 줄)에 `onRequestDelete` 추가:

```tsx
export function PayeeRow({
  row,
  isEditing,
  isSelected,
  onToggleSelect,
  onStartEdit,
  onStopEdit,
  onOpenAttachment,
  onRequestDelete,
}: {
  row: PayeeRowData;
  isEditing: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onOpenAttachment: () => void;
  onRequestDelete: () => void;
}) {
```

관리 컬럼의 편집 버튼 부분부터 컴포넌트 끝까지(177-213번 줄)를 아래로 교체:

```tsx
      <td className={cellCls}>
        {isEditing ? (
          <div className="flex flex-col items-center gap-1">
            <div className="flex justify-center gap-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={pending}
                className="whitespace-nowrap rounded bg-[var(--color-success)] px-3 py-1.5 text-xs text-white disabled:opacity-60"
              >
                {pending ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={pending}
                className="whitespace-nowrap rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
              >
                취소
              </button>
            </div>
            {error && <p className="whitespace-normal text-xs text-[var(--color-danger)]">{error}</p>}
          </div>
        ) : (
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={onStartEdit}
              className="text-[var(--color-muted)] hover:text-[var(--color-primary)]"
              aria-label="편집"
            >
              ✏️
            </button>
            <button
              type="button"
              onClick={onRequestDelete}
              className="text-[var(--color-muted)] hover:text-[var(--color-danger)]"
              aria-label="삭제"
            >
              🗑️
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: `PayeeListPanel.tsx`에 삭제 상태 + 모달 연결**

`src/app/(app)/expenses/PayeeListPanel.tsx` import 구문(1-7번 줄)을 교체:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PayeeRow as PayeeRowData, PayeeSearchField } from "@/lib/data/payees";
import { deletePayeesAction } from "./payees/actions";
import { PayeeUploadModal } from "./PayeeUploadModal";
import { PayeeAttachmentModal } from "./PayeeAttachmentModal";
import { PayeeDeleteConfirmModal } from "./PayeeDeleteConfirmModal";
import { PayeeRow } from "./PayeeRow";
```

컴포넌트 본문 상태 선언부(24-30번 줄)를 `router` 선언 + 삭제 관련 신규 상태 3개를 포함한 아래 블록으로 교체:

```tsx
  const router = useRouter();
  // 체크박스 선택 행(선택만 — 편집과 무관). 다음 단계에서 일괄 작업 연결.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 편집 모드 행(관리 연필 아이콘으로 진입).
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState<{ id: string; keyId: string; bizName: string } | null>(null);
  const [searchField, setSearchField] = useState<PayeeSearchField>(field);
  // 삭제 확인 대상 id 목록. null=모달 닫힘. 개별 삭제는 [id] 하나, 일괄 삭제는 selected 전체.
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
```

`toggleSelectAll` 함수(48-50번 줄) 다음에 삭제 핸들러 추가:

```tsx
  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeletePending(true);
    const result = await deletePayeesAction(deleteTarget);
    setDeletePending(false);
    if (result.ok) {
      setSelected(new Set());
      setDeleteTarget(null);
      router.refresh();
    } else {
      setDeleteError(result.error ?? "삭제 중 오류가 발생했습니다.");
    }
  }

  function handleCancelDelete() {
    setDeleteTarget(null);
    setDeleteError(null);
  }
```

`<PayeeRow>` 호출부(141-152번 줄)에 `onRequestDelete` prop 추가:

```tsx
            {rows.map((r) => (
              <PayeeRow
                key={r.id}
                row={r}
                isEditing={editing.has(r.id)}
                isSelected={selected.has(r.id)}
                onToggleSelect={() => toggleSelect(r.id)}
                onStartEdit={() => startEditing(r.id)}
                onStopEdit={() => stopEditing(r.id)}
                onOpenAttachment={() => setAttachmentTarget({ id: r.id, keyId: r.keyId, bizName: r.bizName })}
                onRequestDelete={() => setDeleteTarget([r.id])}
              />
            ))}
```

파일 끝의 모달 렌더링 부분부터 컴포넌트 끝까지(163-175번 줄)를 아래로 교체:

```tsx
      {uploadOpen && <PayeeUploadModal open onClose={() => setUploadOpen(false)} />}
      {attachmentTarget && (
        <PayeeAttachmentModal
          open
          payeeId={attachmentTarget.id}
          keyId={attachmentTarget.keyId}
          bizName={attachmentTarget.bizName}
          onClose={() => setAttachmentTarget(null)}
        />
      )}
      <PayeeDeleteConfirmModal
        open={deleteTarget !== null}
        count={deleteTarget?.length ?? 0}
        pending={deletePending}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 브라우저로 개별 삭제 동작 확인**

`run` 스킬로 개발 서버를 띄우고 지급리스트 탭에서:
1. 한 행의 🗑️ 버튼 클릭 → 확인 모달이 "1건을 삭제하시겠습니까?"로 뜨는지 확인.
2. 취소 클릭 → 모달만 닫히고 목록은 그대로인지 확인.
3. 다시 🗑️ → 삭제 클릭 → 모달이 닫히고 해당 행이 목록에서 사라지는지 확인.
4. 페이지 새로고침 후에도 삭제된 행이 안 보이는지 확인(서버에서 실제로 숨겨졌는지).

- [ ] **Step 5: 커밋**

```bash
git add src/app/\(app\)/expenses/PayeeRow.tsx src/app/\(app\)/expenses/PayeeListPanel.tsx
git commit -m "feat(payees): 지급리스트 개별 삭제 UI 연결"
```

---

## Task 6: 일괄 삭제 — 상단 액션 바 버튼

**Files:**
- Modify: `src/app/(app)/expenses/PayeeListPanel.tsx`

**Interfaces:**
- Consumes: Task 5에서 만든 `deleteTarget`/`handleConfirmDelete`/`handleCancelDelete`/`selected`(그대로 재사용, 신규 상태 없음).

- [ ] **Step 1: 상단 액션 바에 일괄 삭제 버튼 추가**

`src/app/(app)/expenses/PayeeListPanel.tsx`의 우측 액션 바(93-118번 줄) — 엑셀 다운로드 버튼과 "+ 등록" 버튼 사이에 삭제 버튼 추가:

```tsx
        <div className="flex items-center gap-2">
          {rows.length > 0 ? (
            <a
              href={exportHref}
              className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
            >
              📗 엑셀 다운로드{selectedKeyIds.length > 0 ? ` (${selectedKeyIds.length}건 선택)` : ""}
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
            onClick={() => setDeleteTarget(Array.from(selected))}
            disabled={selected.size === 0}
            className="rounded bg-[var(--color-danger)] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            🗑️ 삭제{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
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

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 브라우저로 일괄 삭제 동작 확인**

개발 서버에서 지급리스트 탭:
1. 체크박스로 2개 이상 행 선택 → 상단 "🗑️ 삭제 (N건 선택)" 버튼이 활성화되는지 확인.
2. 클릭 → 확인 모달에 정확한 건수가 뜨는지 확인.
3. 삭제 확정 → 선택된 행들이 모두 사라지고 체크박스 선택 상태가 초기화되는지 확인.
4. 아무것도 선택하지 않은 상태에서 삭제 버튼이 비활성화(disabled)인지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/app/\(app\)/expenses/PayeeListPanel.tsx
git commit -m "feat(payees): 지급리스트 일괄 삭제 UI 연결"
```

---

## Task 7: 전체 검증

**Files:** 없음(검증만).

- [ ] **Step 1: 전체 테스트 스위트 실행**

Run: `npm test`
Expected: 전체 PASS, 신규 5개 테스트(Task 1의 1개 + Task 2의 4개) 포함.

- [ ] **Step 2: 린트**

Run: `npm run lint`
Expected: 에러 없음.

- [ ] **Step 3: 최종 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 회귀 확인 (검색·엑셀 다운로드·인라인 수정)**

브라우저에서 지급리스트 탭: 검색이 정상 동작하는지, 삭제되지 않은 항목의 엑셀 다운로드가 정상인지, 인라인 수정(✏️ → 저장)이 삭제 버튼 추가로 인해 깨지지 않았는지 확인.
