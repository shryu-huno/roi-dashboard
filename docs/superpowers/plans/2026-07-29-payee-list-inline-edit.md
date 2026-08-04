# 지급 리스트 인라인 수정 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지급 리스트 화면의 행별 편집 UI(이미 존재하는 연필 아이콘/저장/취소)가 실제로
DB에 반영되도록 데이터 계층·검증·서버 액션·클라이언트 저장 로직을 구현한다.

**Architecture:** 서버 컴포넌트가 내려주는 `PayeeRow`(목록 타입) 데이터를 클라이언트에서
편집 → "저장" 클릭 시 새로 만드는 `updatePayeeAction`(서버 액션)을 `FormData`와 함께
직접 호출 → 성공하면 `router.refresh()`로 서버 컴포넌트를 다시 렌더링해 최신 값을 반영한다.
테이블 구조상 `<form>`으로 셀들을 감쌀 수 없으므로 `useTransition` + 서버 액션 직접 호출
방식을 쓴다. 행별 저장 상태(pending/error)를 독립적으로 다루기 위해 테이블 행을
`PayeeRow.tsx` 컴포넌트로 분리한다.

**Tech Stack:** Next.js App Router (Server Actions), React 19 (`useTransition`), Prisma,
Zod, Vitest.

## Global Constraints

- 사업자번호(주민등록번호)는 이번 기능에서 절대 수정 대상에 포함하지 않는다(민감정보, 읽기
  전용 유지) — spec 참조: [[2026-07-29-payee-list-inline-edit-design]].
- `updatePayee`/`updatePayeeAction`은 `ADMIN`/`SETTLEMENT` role만 허용한다(기존
  `fetchMatchedPayees`/`uploadPayeesAction`과 동일한 권한 경계).
- 계좌번호 검증은 기존 업로드 경로와 동일한 규칙(숫자 10~16자리)을 재사용한다.
- 은행명 `<select>`는 DB에 저장된 값이 `BANKS` 목록 밖이어도 그 값을 옵션에 포함해
  select가 항상 현재 값을 정확히 표시하게 한다(저장 시 실수로 값이 바뀌는 것을 방지).
- 커밋은 작업 단위(태스크)별로 나눠서 한다.

---

### Task 1: 데이터 계층 — `updatePayee`

**Files:**
- Modify: `src/lib/data/payees.ts`
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Consumes: 기존 `RlsContext`(`src/lib/rls.ts`), `withRLS`, `encrypt`/`digitsOnly`/
  `maskAccountNumber`(`src/lib/crypto/payee-secret.ts`, `encrypt`/`maskAccountNumber`는
  이 파일에 신규 import 필요 — 기존엔 `decrypt, blindIndex, digitsOnly`만 import돼 있음).
- Produces:
  ```ts
  export type PayeeUpdateInput = {
    bizName: string;
    bankName: string;
    accountNumber: string; // 평문 숫자(하이픈 등 포함 가능 — 내부에서 digitsOnly 처리)
    accountHolder: string;
    taxType: TaxType;
  };
  export function updatePayee(ctx: RlsContext, id: string, input: PayeeUpdateInput): Promise<void>
  ```
  이후 태스크(서버 액션)가 이 시그니처를 그대로 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payees.test.ts` 최상단 import에 `updatePayee`를 추가하고, 파일 끝
`describe("payees 데이터 계층", ...)` 블록의 마지막 `it(...)` 다음에 아래 테스트들을 추가한다.

```ts
// import 수정 (파일 상단, 기존 import 라인 교체):
import {
  createPayeesBulk, listPayees, listPayeesForExport, findPayeeByBizNumber, parsePayeeSearchField,
  updatePayee,
  type PayeeCreateInput,
} from "@/lib/data/payees";
```

```ts
  it("updatePayee: 이름/은행명/계좌번호/예금주/청구방식을 갱신한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Old Name")]);
    const [row] = await listPayees(ADMIN);

    await updatePayee(ADMIN, row.id, {
      bizName: "New Name",
      bankName: "신한은행",
      accountNumber: "999-88-777666",
      accountHolder: "새예금주",
      taxType: "OTHER_INCOME",
    });

    const [after] = await listPayees(ADMIN);
    expect(after.bizName).toBe("New Name");
    expect(after.bankName).toBe("신한은행");
    expect(after.accountNumber).toBe("99988777666");
    expect(after.accountHolder).toBe("새예금주");
    expect(after.taxType).toBe("OTHER_INCOME");
  });

  it("updatePayee는 고유번호·유형·사업자번호(마스킹)를 변경하지 않는다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Old Name")]);
    const [before] = await listPayees(ADMIN);

    await updatePayee(ADMIN, before.id, {
      bizName: "New Name",
      bankName: "신한은행",
      accountNumber: "1101234567890",
      accountHolder: "새예금주",
      taxType: "OTHER_INCOME",
    });

    const [after] = await listPayees(ADMIN);
    expect(after.keyId).toBe(before.keyId);
    expect(after.payeeType).toBe(before.payeeType);
    expect(after.bizNumberMasked).toBe(before.bizNumberMasked);
  });

  it("updatePayee는 SETTLEMENT/ADMIN 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    await expect(
      updatePayee({ userId: "pm1", role: "PM" }, row.id, {
        bizName: "x",
        bankName: "신한은행",
        accountNumber: "1101234567890",
        accountHolder: "y",
        taxType: "OTHER_INCOME",
      }),
    ).rejects.toThrow("지급 리스트 수정 권한이 없습니다.");
  });
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: FAIL — `updatePayee`가 `@/lib/data/payees`에 없어 import 에러 또는 `updatePayee is not a function`.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payees.ts` 상단 import 라인을 교체:

```ts
import { decrypt, encrypt, blindIndex, digitsOnly, maskAccountNumber } from "@/lib/crypto/payee-secret";
```

`getPayeeKeyAndName` 함수 뒤(파일 끝)에 추가:

```ts
// 지급 리스트 인라인 수정 — 사업자번호(민감정보)와 고유번호/유형은 절대 변경하지 않는다.
export type PayeeUpdateInput = {
  bizName: string;
  bankName: string;
  accountNumber: string; // 평문(하이픈 등 포함 가능)
  accountHolder: string;
  taxType: TaxType;
};

export function updatePayee(ctx: RlsContext, id: string, input: PayeeUpdateInput): Promise<void> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 수정 권한이 없습니다.");
  }
  const acctDigits = digitsOnly(input.accountNumber);
  return withRLS(ctx, async (tx) => {
    await tx.payee.update({
      where: { id },
      data: {
        bizName: input.bizName,
        bankName: input.bankName,
        accountNumberEnc: encrypt(acctDigits),
        accountNumberMasked: maskAccountNumber(acctDigits),
        accountHolder: input.accountHolder,
        taxType: input.taxType,
      },
    });
  });
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payees): 지급리스트 인라인 수정용 updatePayee 데이터 함수 추가"
```

---

### Task 2: 검증 스키마 — `payeeUpdateSchema`

**Files:**
- Modify: `src/lib/validation/schemas.ts`
- Test: `test/schemas.test.ts`

**Interfaces:**
- Consumes: 기존 `accountField`(`src/lib/validation/schemas.ts` 내부 정의, 숫자 10~16자리
  검증), `TAX_TYPE_LABELS`(`src/lib/labels.ts`).
- Produces:
  ```ts
  export const payeeUpdateSchema = z.object({
    bizName: z.string().min(1, "이름은 필수입니다."),
    bankName: z.string().min(1, "은행명은 필수입니다."),
    accountNumber: /* accountField 재사용 */,
    accountHolder: z.string().min(1, "예금주는 필수입니다."),
    taxType: z.enum(TAX_TYPE_LABELS),
  });
  ```
  이후 태스크(서버 액션)가 `payeeUpdateSchema.safeParse(...)`로 사용한다. `accountNumber`
  필드는 `payeeUploadRowSchema`와 동일하게 검증 후에도 원본 문자열(하이픈 포함 가능)이
  유지된다 — 자릿수 숫자화는 `updatePayee` 내부(`digitsOnly`)에서 처리한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/schemas.test.ts` 상단 import에 `payeeUpdateSchema` 추가:

```ts
  payeeUploadRowSchema,
  payeeUpdateSchema,
} from "@/lib/validation/schemas";
```

파일 끝, `describe("payeeUploadRowSchema", ...)` 블록 뒤에 추가:

```ts
describe("payeeUpdateSchema", () => {
  const valid = {
    bizName: "홍길동", bankName: "국민은행", accountNumber: "110-123-456789",
    accountHolder: "홍길동", taxType: "사업소득",
  };
  it("유효 입력은 통과", () => {
    expect(payeeUpdateSchema.safeParse(valid).success).toBe(true);
  });
  it("계좌번호 자릿수가 범위를 벗어나면 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, accountNumber: "123" }).success).toBe(false);
  });
  it("이름이 비어있으면 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, bizName: "" }).success).toBe(false);
  });
  it("은행명이 비어있으면 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, bankName: "" }).success).toBe(false);
  });
  it("알 수 없는 청구방식은 실패", () => {
    expect(payeeUpdateSchema.safeParse({ ...valid, taxType: "카드" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: FAIL — `payeeUpdateSchema`가 `@/lib/validation/schemas`에 없음.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/validation/schemas.ts`의 `payeeUploadRowSchema` 정의 바로 뒤에 추가:

```ts
// 지급 리스트 인라인 수정용 — 업로드와 달리 사업자번호/연락처는 다루지 않는다.
export const payeeUpdateSchema = z.object({
  bizName: z.string().min(1, "이름은 필수입니다."),
  bankName: z.string().min(1, "은행명은 필수입니다."),
  accountNumber: accountField,
  accountHolder: z.string().min(1, "예금주는 필수입니다."),
  taxType: z.enum(TAX_TYPE_LABELS),
});
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/validation/schemas.ts test/schemas.test.ts
git commit -m "feat(payees): 지급리스트 인라인 수정 검증 스키마 추가"
```

---

### Task 3: 서버 액션 — `updatePayeeAction`

**Files:**
- Modify: `src/app/(app)/expenses/payees/actions.ts`

**Interfaces:**
- Consumes:
  - `updatePayee(ctx, id, input)` — Task 1.
  - `payeeUpdateSchema` — Task 2.
  - `TAX_TYPE_BY_LABEL`(`src/lib/labels.ts`, 기존 존재) — 청구방식 한글 라벨 →
    `TaxType` enum 매핑.
  - `SAVED`, `ActionState`(`src/lib/action-state.ts`, 기존 존재).
  - `requireRole`, `getRlsContext`, `revalidatePath` — 이 파일에 이미 import돼 있음.
- Produces:
  ```ts
  export async function updatePayeeAction(id: string, formData: FormData): Promise<ActionState>
  ```
  이후 태스크(클라이언트 `PayeeRow.tsx`)가 `id`와 `FormData`(필드명:
  `bizName`, `bankName`, `accountNumber`, `accountHolder`, `taxType`)로 이 함수를 직접
  호출한다.

이 태스크는 자동화 테스트를 추가하지 않는다 — `requireRole`이 NextAuth 런타임을 최상위에서
import하기 때문에(기존 `uploadPayeesAction`도 동일한 이유로 직접 테스트가 없다) 이미
검증된 `updatePayee`/`payeeUpdateSchema`를 얇게 감싸는 배선 코드만 남는다. 타입 체크와
Task 5의 수동 브라우저 확인으로 검증한다.

- [ ] **Step 1: import 추가**

`src/app/(app)/expenses/payees/actions.ts` 상단 import 블록을 아래처럼 교체:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { createPayeesBulk, updatePayee } from "@/lib/data/payees";
import { PayeeKeyConfigError } from "@/lib/crypto/payee-secret";
import { TAX_TYPE_BY_LABEL } from "@/lib/labels";
import { payeeUpdateSchema } from "@/lib/validation/schemas";
import { SAVED, type ActionState } from "@/lib/action-state";
import { buildPayeeInputsFromCsv, buildPayeeInputsFromRows, type BuildResult } from "./build-inputs";
import { parseXlsxToRows } from "./xlsx";
import type { PayeeUploadState } from "./upload-state";
```

- [ ] **Step 2: `updatePayeeAction` 추가**

파일 끝(`uploadPayeesAction` 함수 뒤)에 추가:

```ts
export async function updatePayeeAction(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const parsed = payeeUpdateSchema.safeParse({
    bizName: formData.get("bizName"),
    bankName: formData.get("bankName"),
    accountNumber: formData.get("accountNumber"),
    accountHolder: formData.get("accountHolder"),
    taxType: formData.get("taxType"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  try {
    await updatePayee(ctx, id, {
      bizName: d.bizName,
      bankName: d.bankName,
      accountNumber: d.accountNumber,
      accountHolder: d.accountHolder,
      taxType: TAX_TYPE_BY_LABEL[d.taxType],
    });
  } catch (e) {
    console.error("[payee update] 수정 실패:", e);
    return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (이 파일·연관 파일에 대해).

- [ ] **Step 4: 커밋**

```bash
git add src/app/\(app\)/expenses/payees/actions.ts
git commit -m "feat(payees): 지급리스트 인라인 수정 서버 액션 추가"
```

---

### Task 4: 클라이언트 UI — `PayeeRow` 분리 + 저장 연결

**Files:**
- Modify: `src/lib/labels.ts` (BANKS 이동)
- Modify: `src/app/(app)/expenses/PayeeListPanel.tsx`
- Create: `src/app/(app)/expenses/PayeeRow.tsx`

**Interfaces:**
- Consumes:
  - `updatePayeeAction(id, formData)` — Task 3.
  - `PayeeRow`(타입, `src/lib/data/payees.ts`) — 기존 목록 행 타입. **이름 충돌 주의**:
    새 컴포넌트 파일명도 `PayeeRow.tsx`이므로, 타입은 `import type { PayeeRow as PayeeRowData } from "@/lib/data/payees";`로 별칭 import한다.
  - `TAX_TYPE_LABELS`, `taxTypeLabel`, `BANKS`(이동 후) — `src/lib/labels.ts`.
  - `TaxBadge`, `AttachmentCell`, `inputCls`, `cellCls` — 현재 `PayeeListPanel.tsx`에 정의된
    헬퍼. `PayeeRow.tsx`로 옮기거나 export해서 재사용(아래 Step 1에서 export로 처리).
- Produces: `PayeeRow.tsx`의 export:
  ```ts
  export function PayeeRow({
    row, isEditing, isSelected, onToggleSelect, onStartEdit, onStopEdit, onOpenAttachment,
  }: {
    row: PayeeRowData;
    isEditing: boolean;
    isSelected: boolean;
    onToggleSelect: () => void;
    onStartEdit: () => void;
    onStopEdit: () => void;
    onOpenAttachment: () => void;
  }): JSX.Element
  ```

이 태스크는 UI 동작이라 자동 유닛 테스트 없이 수동 브라우저 확인으로 검증한다(design 문서
5번 항목).

- [ ] **Step 1: `BANKS`를 `labels.ts`로 이동**

`src/lib/labels.ts` 끝에 추가:

```ts
// 은행명 편집용 드롭다운 옵션.
export const BANKS = ["국민은행", "신한은행", "하나은행", "우리은행", "농협은행", "기업은행", "카카오뱅크", "토스뱅크"] as const;
```

`src/app/(app)/expenses/PayeeListPanel.tsx`에서 다음 줄을 삭제:

```ts
// 은행명 편집용 드롭다운 옵션.
const BANKS = ["국민은행", "신한은행", "하나은행", "우리은행", "농협은행", "기업은행", "카카오뱅크", "토스뱅크"] as const;
```

같은 파일 상단 import에 `BANKS` 추가는 이번 파일에서 더 이상 `BANKS`를 쓰지 않으므로
불필요(Step 3에서 `PayeeRow.tsx`가 렌더링을 넘겨받음). `taxTypeLabel` import도 `TaxBadge`와
함께 `PayeeRow.tsx`로 옮기므로 이 파일에서 제거한다(Step 2 참고).

- [ ] **Step 2: `PayeeListPanel.tsx`에서 행 렌더링 관련 헬퍼를 `PayeeRow.tsx`로 이동**

`src/app/(app)/expenses/PayeeListPanel.tsx`에서 아래 것들을 **잘라내어**
`src/app/(app)/expenses/PayeeRow.tsx`(신규 파일)로 옮긴다:
- `TAX_BADGE_CLASS`, `TaxBadge` 함수
- `AttachmentCell` 함수
- `inputCls`, `cellCls` 상수
- `<tr>` 렌더링 블록 전체(현재 `rows.map((r) => { ... })` 내부, `PayeeListPanel.tsx:187-279`)

`PayeeListPanel.tsx`는 이미 `@/lib/data/payees`의 **타입** `PayeeRow`를 `rows: PayeeRow[]`로
쓰고 있다. 새로 만드는 **컴포넌트**도 이름이 `PayeeRow`라 그대로 두면 같은 파일 안에서 이름이
겹친다. 타입 쪽을 별칭으로 바꿔 충돌을 피한다. 상단 import 블록을 아래로 교체:

```ts
"use client";

import { useState } from "react";
import type { PayeeRow as PayeeRowData, PayeeSearchField } from "@/lib/data/payees";
import { PayeeUploadModal } from "./PayeeUploadModal";
import { PayeeAttachmentModal } from "./PayeeAttachmentModal";
import { PayeeRow } from "./PayeeRow";
```

(`taxTypeLabel`, `TaxType` import는 `TaxBadge`와 함께 `PayeeRow.tsx`로 옮겨갔으므로 제거한다.)

`PayeeListPanel` 함수 시그니처의 `rows: PayeeRow[]`도 `rows: PayeeRowData[]`로 바꾼다.

`rows.map(...)` 부분을 아래로 교체:

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
  />
))}
```

- [ ] **Step 3: `PayeeRow.tsx` 작성 (저장 로직 포함)**

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxType } from "@prisma/client";
import type { PayeeRow as PayeeRowData } from "@/lib/data/payees";
import { BANKS, TAX_TYPE_LABELS, taxTypeLabel } from "@/lib/labels";
import { updatePayeeAction } from "./payees/actions";

const TAX_BADGE_CLASS: Record<TaxType, string> = {
  TAX_INVOICE: "bg-blue-100 text-blue-700",
  TAX_FREE_INVOICE: "bg-green-100 text-green-700",
  BUSINESS_INCOME: "bg-amber-100 text-amber-700",
  OTHER_INCOME: "bg-gray-100 text-gray-600",
  CASH_RECEIPT: "bg-teal-100 text-teal-700",
  HANDWRITTEN_INVOICE: "bg-purple-100 text-purple-700",
};

function TaxBadge({ taxType }: { taxType: TaxType }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TAX_BADGE_CLASS[taxType]}`}>
      {taxTypeLabel(taxType)}
    </span>
  );
}

function AttachmentCell({ hasAttachment, onClick }: { hasAttachment: boolean; onClick: () => void }) {
  if (hasAttachment) {
    return (
      <button type="button" onClick={onClick} className="whitespace-nowrap text-sm text-[var(--color-primary)] hover:underline">
        📎 첨부완료
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-block whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-[var(--color-danger)] hover:underline"
    >
      ⚠ 미첨부
    </button>
  );
}

const inputCls =
  "w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-center text-sm focus:border-[var(--color-primary)] focus:outline-none";
const cellCls = "whitespace-nowrap px-3 py-2 text-center align-middle";

export function PayeeRow({
  row,
  isEditing,
  isSelected,
  onToggleSelect,
  onStartEdit,
  onStopEdit,
  onOpenAttachment,
}: {
  row: PayeeRowData;
  isEditing: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onOpenAttachment: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const bizNameRef = useRef<HTMLInputElement>(null);
  const bankNameRef = useRef<HTMLSelectElement>(null);
  const accountNumberRef = useRef<HTMLInputElement>(null);
  const accountHolderRef = useRef<HTMLInputElement>(null);
  const taxTypeRef = useRef<HTMLSelectElement>(null);

  // DB 값이 BANKS 목록 밖이면(과거 데이터 등) select가 첫 옵션으로 조용히 바뀌는 것을 막기 위해
  // 현재 값을 옵션 맨 앞에 추가한다.
  const bankOptions: readonly string[] = BANKS.includes(row.bankName as (typeof BANKS)[number])
    ? BANKS
    : [row.bankName, ...BANKS];

  function handleCancel() {
    setError(null);
    onStopEdit();
  }

  function handleSave() {
    const formData = new FormData();
    formData.set("bizName", bizNameRef.current!.value);
    formData.set("bankName", bankNameRef.current!.value);
    formData.set("accountNumber", accountNumberRef.current!.value);
    formData.set("accountHolder", accountHolderRef.current!.value);
    formData.set("taxType", taxTypeRef.current!.value);

    setError(null);
    startTransition(async () => {
      const result = await updatePayeeAction(row.id, formData);
      if (result.ok) {
        router.refresh();
        onStopEdit();
      } else {
        setError(result.error ?? "수정 중 오류가 발생했습니다.");
      }
    });
  }

  return (
    <tr className={`border-b border-[var(--color-border)] ${isEditing || isSelected ? "bg-[var(--color-hover)]" : ""}`}>
      <td className={cellCls}>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect} aria-label={`${row.bizName} 선택`} />
      </td>
      <td className={`${cellCls} font-medium text-[var(--color-primary)]`}>{row.keyId}</td>

      <td className={cellCls}>
        {isEditing ? <input ref={bizNameRef} className={inputCls} defaultValue={row.bizName} /> : row.bizName}
      </td>

      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.bizNumberMasked}</td>

      <td className={cellCls}>
        {isEditing ? (
          <select ref={bankNameRef} className={inputCls} defaultValue={row.bankName}>
            {bankOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        ) : (
          row.bankName
        )}
      </td>

      <td className={cellCls}>
        {isEditing ? <input ref={accountNumberRef} className={inputCls} defaultValue={row.accountNumber} /> : row.accountNumber}
      </td>

      <td className={cellCls}>
        {isEditing ? <input ref={accountHolderRef} className={inputCls} defaultValue={row.accountHolder} /> : row.accountHolder}
      </td>

      <td className={cellCls}>
        {isEditing ? (
          <select ref={taxTypeRef} className={inputCls} defaultValue={taxTypeLabel(row.taxType)}>
            {TAX_TYPE_LABELS.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
        ) : (
          <TaxBadge taxType={row.taxType} />
        )}
      </td>

      <td className={cellCls}>
        <AttachmentCell hasAttachment={row.hasBizCert || row.hasBankbook} onClick={onOpenAttachment} />
      </td>

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
          <button
            type="button"
            onClick={onStartEdit}
            className="text-[var(--color-muted)] hover:text-[var(--color-primary)]"
            aria-label="편집"
          >
            ✏️
          </button>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음.

- [ ] **Step 5: 개발 서버로 수동 확인**

Run: `npm run dev`, 브라우저에서 `/expenses?tab=payment-list` 접속(ADMIN/SETTLEMENT 계정).

확인 항목:
1. 연필 아이콘 클릭 → 사업자명/은행명/계좌번호/예금주/청구방식이 편집 가능한 인풋/드롭다운으로
   바뀐다.
2. 값을 바꾸고 "저장" 클릭 → "저장 중..." 표시 후 편집 모드가 꺼지고 목록에 새 값이 반영된다.
3. 계좌번호를 9자리 이하로 줄여서 저장 시도 → 편집 모드가 유지되고 행 아래 에러 메시지가
   보인다.
4. "취소" 클릭 → 편집 모드가 꺼지고 원래 값으로 되돌아간다(저장 안 됨).
5. (가능하면) 시드 데이터에서 은행명이 `BANKS` 목록 밖인 행을 하나 만들어 편집 모드
   진입 시 select가 그 값을 정확히 보여주는지 확인. 어려우면 이 항목은 스킵하고 코드
   리뷰로 대체.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/labels.ts src/app/\(app\)/expenses/PayeeListPanel.tsx src/app/\(app\)/expenses/PayeeRow.tsx
git commit -m "feat(payees): 지급리스트 행 편집 저장 기능 연결"
```

---

### Task 5: 전체 검증

**Files:** 없음(검증만)

- [ ] **Step 1: 전체 테스트 스위트 실행**

Run: `npm run test`
Expected: 전체 PASS.

- [ ] **Step 2: 전체 린트 실행**

Run: `npm run lint`
Expected: 에러 없음.

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공.
