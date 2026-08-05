# PM 지급요청 등록 화면 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM 지급요청 등록 화면(`/expenses/payment-request/new`)에서 No/청구방식 컬럼 제거, 고객사·사업자명 자동완성 개선(호버 툴팁 포함), 입력칸 예시/정렬/폭 조정, 그리고 실제 저장(서버 액션 + DB 반영) 기능을 완성한다.

**Architecture:** 기존 레포 관례를 그대로 따른다 — 데이터 계층(`src/lib/data/*.ts`)은 `withRLS` 트랜잭션으로 DB에 접근하고, `"use server"` 액션(`actions.ts`)이 `requireUser`/zod 검증 뒤 데이터 계층을 호출하며, 클라이언트 컴포넌트는 `ActionState({ok, error})`를 그대로 화면에 반영한다. 사업자/고객사 자동완성은 기존 `PayeeCombobox` 콜백 패턴을 그대로 복제해 신규 고객사 콤보박스를 만든다. 저장 검증(행별 필수값)은 React와 분리된 순수 함수 모듈로 뽑아 유닛 테스트한다.

**Tech Stack:** Next.js App Router, React (client components), Prisma + PostgreSQL RLS, Zod, Vitest(실 DB 통합 테스트, `test/global-setup.ts`가 `.env.test`로 마이그레이션 후 실행).

## Global Constraints

- Prisma 스키마/마이그레이션 변경 없음 — 기존 `PaymentRequest`/`Payee`/`Client` 모델 그대로 사용.
- 저장은 all-or-nothing(한 트랜잭션) — `withRLS`가 이미 `prisma.$transaction`으로 감싸므로 별도 트랜잭션 코드를 추가하지 않는다.
- 색상은 반드시 디자인 토큰(CSS 변수) 사용 — 에러 테두리/텍스트는 `var(--color-danger)`, 기본 테두리는 `var(--color-border)`. Tailwind 기본 팔레트(`border-red-500` 등) 직접 사용 금지.
- React 컴포넌트 자동 테스트는 레포 관례상 존재하지 않는다(`vitest.config.ts`가 `environment: "node"`) — UI 작업은 수동 검증만, 순수 로직/데이터 계층은 실제 테스트 DB(`.env.test`)에 대한 통합 테스트로 검증한다(모킹 금지, 기존 `test/data-*.test.ts` 패턴을 그대로 따른다).
- `npx tsc --noEmit`은 모든 태스크 종료 시 통과해야 한다.
- 화면 문구는 한글 유지, 기존 라벨/문구 관례(`src/lib/labels.ts`)를 그대로 사용.

---

## File Structure

**신규:**
- `src/components/PaymentRequestClientCombobox.tsx` — 고객사 검색형 선택(콤보박스), `PayeeCombobox`와 동일한 콜백 패턴.
- `src/lib/payment-request-validation.ts` — 행별 필수값 검증(순수 함수) + `DraftRow` → 서버 입력 변환.
- `test/payment-request-validation.test.ts` — 위 순수 함수 유닛 테스트.

**수정:**
- `src/lib/data/payees.ts` — `PayeeOption`에 `taxType` 추가.
- `src/lib/data/payment-requests.ts` — `createPaymentRequestsBulk` + `PaymentRequestCreateInput` 타입 추가.
- `src/lib/validation/schemas.ts` — `paymentRequestRowSchema` 추가.
- `src/app/(app)/expenses/actions.ts` — `createPaymentRequests` 서버 액션 추가.
- `src/components/PayeeCombobox.tsx` — 정렬/드롭다운 높이/호버 툴팁/에러 테두리.
- `src/app/(app)/expenses/PaymentRequestRowsTable.tsx` — No/청구방식 컬럼 제거, 컬럼 폭 조정, placeholder, 고객사 콤보박스 교체, 사업자 선택 시 청구방식 자동반영, 에러 하이라이트.
- `src/app/(app)/expenses/PaymentRequestNewForm.tsx` — 검증 → 서버 액션 호출 → 성공 시 목록 이동, 에러 배너.
- `test/data-payees.test.ts` — `listPayeeOptions` 반환 타입 테스트에 `taxType` 반영.
- `test/data-payment-requests.test.ts` — `reset()`에 `payee` 정리 추가 + `createPaymentRequestsBulk` 테스트 추가.
- `test/schemas.test.ts` — `paymentRequestRowSchema` 테스트 추가.

---

## Task 1: `PayeeOption`에 청구방식(taxType) 추가

**Files:**
- Modify: `src/lib/data/payees.ts:406-417`
- Test: `test/data-payees.test.ts:452-459`

**Interfaces:**
- Produces: `PayeeOption = { id: string; keyId: string; bizName: string; taxType: TaxType }` — Task 4/6/8이 이 필드를 사용한다.

- [ ] **Step 1: 기존 테스트를 새 기대값으로 수정 (먼저 깨뜨리기)**

`test/data-payees.test.ts`의 마지막 테스트를 다음으로 교체:

```ts
  it("listPayeeOptions는 역할 무관하게 id/keyId/bizName/taxType만 반환한다(계좌·사업자번호 등 민감정보 없음)", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "업체1"), input("9001011234567", "INSTRUCTOR", "강사1")]);
    const pmOptions = await listPayeeOptions({ userId: "pm1", role: "PM" });
    expect(pmOptions.sort((a, b) => a.bizName.localeCompare(b.bizName))).toEqual([
      { id: expect.any(String), keyId: "b001", bizName: "업체1", taxType: "TAX_INVOICE" },
      { id: expect.any(String), keyId: "a001", bizName: "강사1", taxType: "BUSINESS_INCOME" },
    ].sort((a, b) => a.bizName.localeCompare(b.bizName)));
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/data-payees.test.ts -t "listPayeeOptions"`
Expected: FAIL (실제 반환값에 `taxType` 없음, `toEqual` 불일치)

- [ ] **Step 3: `PayeeOption` 타입과 `listPayeeOptions` 수정**

`src/lib/data/payees.ts:406-417`을 다음으로 교체:

```ts
// 지급요청 등록 화면의 사업자명(이름) 검색 콤보박스용 — 민감정보(계좌/사업자번호) 없이
// id/keyId/bizName/taxType만. Payee의 SELECT RLS(payee_select)는 전 역할 허용이라 role 분기가
// 필요 없다. taxType은 지급요청 등록 시 청구방식을 자동 반영하고 호버 툴팁에 쓰기 위함(마스킹 대상 아님).
export type PayeeOption = { id: string; keyId: string; bizName: string; taxType: TaxType };

export function listPayeeOptions(ctx: RlsContext): Promise<PayeeOption[]> {
  return withRLS(ctx, (tx) =>
    tx.payee.findMany({
      where: { deletedAt: null },
      select: { id: true, keyId: true, bizName: true, taxType: true },
      orderBy: { bizName: "asc" },
    }),
  );
}
```

(`TaxType`은 이미 파일 상단에서 `@prisma/client`로부터 import되어 있는지 확인 — 없으면 추가.)

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS (전체 `data-payees.test.ts` 스위트)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payment-request): PayeeOption에 taxType 추가"
```

---

## Task 2: 저장 검증 순수 함수 모듈

**Files:**
- Create: `src/lib/payment-request-validation.ts`
- Test: `test/payment-request-validation.test.ts`

**Interfaces:**
- Consumes: 없음(독립 — React나 다른 태스크의 산출물에 의존하지 않는 순수 함수 모듈).
- Produces (이 태스크가 `PaymentRequestCreateInput`의 최초 정의 위치다 — Task 4/5는 이 타입을 import해서 재사용한다):
  - `PaymentRequestDraftRow = { key: string; entity: string; clientId: string; payeeId: string | null; unitPrice: string; transportFee: string; materialFee: string; count: string; memo: string }`
  - `PaymentRequestRowField = "entity" | "clientId" | "payeeId" | "unitPrice" | "count"`
  - `PaymentRequestCreateInput = { entity: "HUNO" | "HUNO_INC"; clientId: string; payeeId: string; unitPrice: number; transportFee: number; materialFee: number; count: number; memo: string }` — Task 4(`createPaymentRequestsBulk`)와 Task 5(서버 액션)가 import해서 쓴다.
  - `validateDraftRows(rows: PaymentRequestDraftRow[]): Map<string, Set<PaymentRequestRowField>>` — Task 9(NewForm)가 저장 전 검증에 사용.
  - `toPaymentRequestCreateInputs(rows: PaymentRequestDraftRow[]): PaymentRequestCreateInput[]` — Task 9가 서버 액션 호출 직전 변환에 사용. **`validateDraftRows`가 빈 Map을 반환한 뒤에만 호출해야 한다** (entity/payeeId가 비어있지 않다고 가정하고 캐스팅함).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payment-request-validation.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import {
  validateDraftRows, toPaymentRequestCreateInputs, type PaymentRequestDraftRow,
} from "@/lib/payment-request-validation";

function row(overrides: Partial<PaymentRequestDraftRow> = {}): PaymentRequestDraftRow {
  return {
    key: "r1", entity: "HUNO", clientId: "c1", payeeId: "p1",
    unitPrice: "10000", transportFee: "0", materialFee: "0", count: "1", memo: "",
    ...overrides,
  };
}

describe("validateDraftRows", () => {
  it("모든 필수값이 있으면 에러가 없다", () => {
    expect(validateDraftRows([row()]).size).toBe(0);
  });

  it("지급명의/고객사/사업자가 비어있으면 각각 에러를 낸다", () => {
    const errors = validateDraftRows([row({ entity: "", clientId: "", payeeId: null })]);
    expect(errors.get("r1")).toEqual(new Set(["entity", "clientId", "payeeId"]));
  });

  it("단가/횟수가 0 이하이면 에러를 낸다", () => {
    const errors = validateDraftRows([row({ unitPrice: "0", count: "0" })]);
    expect(errors.get("r1")).toEqual(new Set(["unitPrice", "count"]));
  });

  it("교통비/재료비는 0이어도 에러가 아니다", () => {
    expect(validateDraftRows([row({ transportFee: "0", materialFee: "0" })]).size).toBe(0);
  });

  it("여러 행 중 문제 있는 행만 에러 맵에 담는다", () => {
    const errors = validateDraftRows([row({ key: "ok" }), row({ key: "bad", clientId: "" })]);
    expect(errors.has("ok")).toBe(false);
    expect(errors.get("bad")).toEqual(new Set(["clientId"]));
  });
});

describe("toPaymentRequestCreateInputs", () => {
  it("문자열 필드를 숫자로 변환하고 필요한 필드만 남긴다", () => {
    const [input] = toPaymentRequestCreateInputs([
      row({ unitPrice: "50000", transportFee: "1000", materialFee: "2000", count: "3" }),
    ]);
    expect(input).toEqual({
      entity: "HUNO", clientId: "c1", payeeId: "p1",
      unitPrice: 50000, transportFee: 1000, materialFee: 2000, count: 3, memo: "",
    });
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/payment-request-validation.test.ts`
Expected: FAIL (`Cannot find module '@/lib/payment-request-validation'`)

- [ ] **Step 3: 구현**

`src/lib/payment-request-validation.ts` 생성:

```ts
// PM 지급요청 등록 화면(행 편집기)의 행별 필수값 검증 + 서버 액션 입력 변환. React에 의존하지
// 않는 순수 함수로 분리해 유닛 테스트한다. DraftRow(PaymentRequestRowsTable.tsx)는 여기 정의된
// PaymentRequestDraftRow보다 필드가 많지만(taxType/bizName 등) 구조적으로 호환되므로 그대로 넘길 수 있다.

export type PaymentRequestDraftRow = {
  key: string;
  entity: string;
  clientId: string;
  payeeId: string | null;
  unitPrice: string;
  transportFee: string;
  materialFee: string;
  count: string;
  memo: string;
};

export type PaymentRequestRowField = "entity" | "clientId" | "payeeId" | "unitPrice" | "count";

export type PaymentRequestCreateInput = {
  entity: "HUNO" | "HUNO_INC";
  clientId: string;
  payeeId: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  memo: string;
};

// 행별 필수값 검사. 교통비/재료비는 0을 허용하므로 검사 대상이 아니다. 한 행이라도 문제가
// 있으면 전체 저장을 막아야 하므로, 호출부는 이 Map이 비어있는지(size===0)로 저장 가능 여부를 판단한다.
export function validateDraftRows(rows: PaymentRequestDraftRow[]): Map<string, Set<PaymentRequestRowField>> {
  const errors = new Map<string, Set<PaymentRequestRowField>>();
  for (const row of rows) {
    const bad = new Set<PaymentRequestRowField>();
    if (!row.entity) bad.add("entity");
    if (!row.clientId) bad.add("clientId");
    if (!row.payeeId) bad.add("payeeId");
    if (Number(row.unitPrice) <= 0) bad.add("unitPrice");
    if (Number(row.count) <= 0) bad.add("count");
    if (bad.size > 0) errors.set(row.key, bad);
  }
  return errors;
}

// validateDraftRows가 빈 Map을 반환한 행만 이 함수로 넘겨야 한다 — entity/payeeId가 비어있지
// 않음을 전제로 캐스팅한다.
export function toPaymentRequestCreateInputs(rows: PaymentRequestDraftRow[]): PaymentRequestCreateInput[] {
  return rows.map((row) => ({
    entity: row.entity as "HUNO" | "HUNO_INC",
    clientId: row.clientId,
    payeeId: row.payeeId as string,
    unitPrice: Number(row.unitPrice) || 0,
    transportFee: Number(row.transportFee) || 0,
    materialFee: Number(row.materialFee) || 0,
    count: Number(row.count) || 0,
    memo: row.memo,
  }));
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/payment-request-validation.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/payment-request-validation.ts test/payment-request-validation.test.ts
git commit -m "feat(payment-request): 등록 화면 행 검증 순수 함수 모듈 추가"
```

---

## Task 3: 저장 zod 스키마

**Files:**
- Modify: `src/lib/validation/schemas.ts`
- Test: `test/schemas.test.ts`

**Interfaces:**
- Consumes: 없음 (독립).
- Produces: `paymentRequestRowSchema` (zod) — Task 5(서버 액션)가 `z.array(paymentRequestRowSchema)`로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/schemas.test.ts` 상단 import에 `paymentRequestRowSchema` 추가:

```ts
import {
  performanceBatchSchema,
  expenseSchema,
  billingSchema,
  taskSchema,
  clientSchema,
  payeeUploadRowSchema,
  payeeUpdateSchema,
  payeeUpdatePmSchema,
  paymentRequestRowSchema,
} from "@/lib/validation/schemas";
```

파일 끝에 추가:

```ts
describe("paymentRequestRowSchema", () => {
  const valid = { entity: "HUNO", clientId: "c1", payeeId: "p1", unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" };

  it("유효한 값은 통과한다", () => {
    expect(paymentRequestRowSchema.safeParse(valid).success).toBe(true);
  });
  it("단가가 0이면 실패한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, unitPrice: 0 }).success).toBe(false);
  });
  it("횟수가 0이면 실패한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, count: 0 }).success).toBe(false);
  });
  it("교통비/재료비는 0이어도 통과한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, transportFee: 0, materialFee: 0 }).success).toBe(true);
  });
  it("알 수 없는 지급명의는 실패한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, entity: "HACKED" }).success).toBe(false);
  });
  it("고객사/사업자 id가 비어있으면 실패한다", () => {
    expect(paymentRequestRowSchema.safeParse({ ...valid, clientId: "" }).success).toBe(false);
    expect(paymentRequestRowSchema.safeParse({ ...valid, payeeId: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: FAIL (`paymentRequestRowSchema` is not exported)

- [ ] **Step 3: 구현**

`src/lib/validation/schemas.ts` 파일 끝(`payeeUpdatePmSchema` 뒤)에 추가:

```ts
// PM 등록 화면 행 하나. 단가/횟수는 0보다 커야 하고(0이면 무의미), 교통비/재료비는 0을 허용한다.
// entity/payeeId/clientId는 화면에서 자동완성/드롭다운으로만 채워지므로 빈 문자열이면 거부한다.
export const paymentRequestRowSchema = z.object({
  entity: z.enum(["HUNO", "HUNO_INC"]),
  clientId: z.string().min(1),
  payeeId: z.string().min(1),
  unitPrice: z.coerce.number().int().min(1),
  transportFee: z.coerce.number().int().min(0),
  materialFee: z.coerce.number().int().min(0),
  count: z.coerce.number().int().min(1),
  memo: z.string(),
});
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/validation/schemas.ts test/schemas.test.ts
git commit -m "feat(payment-request): 등록 행 저장용 zod 스키마 추가"
```

---

## Task 4: `createPaymentRequestsBulk` 데이터 계층 함수

**Files:**
- Modify: `src/lib/data/payment-requests.ts`
- Modify: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: `PaymentRequestCreateInput`(Task 2에서 `src/lib/payment-request-validation.ts`에 정의됨 — 이 태스크는 그 타입을 재사용(import)한다), `withRLS`/`RlsContext`(이미 파일에 import되어 있음).
- Produces: `createPaymentRequestsBulk(ctx: RlsContext, requesterId: string, inputs: PaymentRequestCreateInput[]): Promise<ActionState>` — Task 5(서버 액션)가 호출.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-requests.test.ts` 상단 import 교체:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";
import {
  listPaymentRequests, parsePaymentRequestPage, parsePaymentRequestEntity,
  parsePaymentRequestStatus, parsePaymentRequestDateParam, PAYMENT_REQUEST_PAGE_SIZE,
  createPaymentRequestsBulk,
} from "@/lib/data/payment-requests";
import type { PaymentRequestCreateInput } from "@/lib/payment-request-validation";
import { createPayeesBulk } from "@/lib/data/payees";
import { encrypt, blindIndex, maskBizNumber, maskAccountNumber } from "@/lib/crypto/payee-secret";
```

`reset()`을 다음으로 교체(payee 정리 추가):

```ts
async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.paymentRequest.deleteMany();
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
    await tx.client.deleteMany();
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_instructor" RESTART WITH 1');
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_vendor" RESTART WITH 1');
  });
  await prisma.user.deleteMany();
}
```

`seed()` 함수 뒤, `baseInput()` 함수 앞에 사업자 생성 헬퍼 추가:

```ts
function payeeInput(bizDigits: string, bizName: string, taxType: "TAX_INVOICE" | "BUSINESS_INCOME" = "TAX_INVOICE") {
  const acct = "110123456789";
  return {
    payeeType: "VENDOR" as const,
    bizName,
    bizNumberEnc: encrypt(bizDigits),
    bizNumberMasked: maskBizNumber(bizDigits, "VENDOR"),
    bizNumberBidx: blindIndex(bizDigits),
    phone: "010-1234-5678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: encrypt(acct),
    accountNumberMasked: maskAccountNumber(acct),
    accountHolder: "예금주",
    taxType,
  };
}

async function createPayee(bizDigits: string, bizName: string, taxType?: "TAX_INVOICE" | "BUSINESS_INCOME") {
  await createPayeesBulk(ADMIN, [payeeInput(bizDigits, bizName, taxType)]);
  const [payee] = await withRLS(ADMIN, (tx) => tx.payee.findMany({ where: { bizName } }));
  return payee;
}
```

파일 끝(마지막 `describe` 블록의 마지막 `it` 뒤, 닫는 `});` 앞)에 새 `describe` 블록 추가:

```ts
  describe("createPaymentRequestsBulk", () => {
    it("선택한 사업자의 bizName/taxType을 스냅샷으로 저장하고 지급액을 서버가 재계산한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1234567890", "업체A", "TAX_INVOICE");
      const input: PaymentRequestCreateInput = {
        entity: "HUNO", clientId: clientA.id, payeeId: payee.id,
        unitPrice: 100000, transportFee: 5000, materialFee: 2000, count: 3, memo: "테스트",
      };
      const result = await createPaymentRequestsBulk({ userId: pmA.id, role: "PM" }, pmA.id, [input]);
      expect(result.ok).toBe(true);

      const { rows } = await listPaymentRequests(ADMIN);
      expect(rows).toHaveLength(1);
      expect(rows[0].bizName).toBe("업체A");
      expect(rows[0].taxType).toBe("TAX_INVOICE");
      expect(rows[0].amount).toBe((100000 + 5000 + 2000) * 3);
    });

    it("존재하지 않는 payeeId가 섞여 있으면 전체 저장을 거부한다(all-or-nothing)", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1234567890", "업체A");
      const inputs: PaymentRequestCreateInput[] = [
        { entity: "HUNO", clientId: clientA.id, payeeId: payee.id, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" },
        { entity: "HUNO", clientId: clientA.id, payeeId: "존재하지않는아이디", unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" },
      ];
      const result = await createPaymentRequestsBulk({ userId: pmA.id, role: "PM" }, pmA.id, inputs);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("소프트 삭제된 사업자로는 저장할 수 없다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1234567890", "삭제된업체");
      await withRLS(ADMIN, (tx) => tx.payee.update({ where: { id: payee.id }, data: { deletedAt: new Date() } }));

      const result = await createPaymentRequestsBulk(
        { userId: pmA.id, role: "PM" }, pmA.id,
        [{ entity: "HUNO", clientId: clientA.id, payeeId: payee.id, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" }],
      );
      expect(result.ok).toBe(false);
    });

    it("PM이 담당하지 않는 고객사로 저장을 시도하면 RLS로 거부된다", async () => {
      const { pmA, clientB } = await seed();
      const payee = await createPayee("1234567890", "업체A");
      await expect(
        createPaymentRequestsBulk(
          { userId: pmA.id, role: "PM" }, pmA.id,
          [{ entity: "HUNO", clientId: clientB.id, payeeId: payee.id, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" }],
        ),
      ).rejects.toThrow(/로우 단위 보안 정책|row-level security/i);
    });

    it("여러 행을 한 번에 저장한다", async () => {
      const { pmA, clientA } = await seed();
      const payeeA = await createPayee("1111111111", "업체1");
      const payeeB = await createPayee("2222222222", "업체2");
      const result = await createPaymentRequestsBulk(
        { userId: pmA.id, role: "PM" }, pmA.id,
        [
          { entity: "HUNO", clientId: clientA.id, payeeId: payeeA.id, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "" },
          { entity: "HUNO", clientId: clientA.id, payeeId: payeeB.id, unitPrice: 20000, transportFee: 0, materialFee: 0, count: 2, memo: "" },
        ],
      );
      expect(result.ok).toBe(true);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(2);
    });
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: FAIL (`createPaymentRequestsBulk` is not exported)

- [ ] **Step 3: 구현**

`src/lib/data/payment-requests.ts` 파일 끝에 추가 (상단 import에 `type { ActionState }`와 `type { PaymentRequestCreateInput }`을 더한다):

```ts
import type { PaymentRequestEntity, PaymentRequestStatus, Prisma, TaxType } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import type { ActionState } from "@/lib/action-state";
import type { PaymentRequestCreateInput } from "@/lib/payment-request-validation";
```

파일 끝에 추가:

```ts
// PM 등록 화면에서 여러 행을 한 번에 저장한다. 사업자명/청구방식은 클라이언트 값을 신뢰하지
// 않고 저장 시점에 Payee 테이블에서 다시 조회한 값을 스냅샷으로 남긴다 — payeeId만 클라이언트가
// 정하고, 실제 표시값은 서버가 확정한다(변조·오염 방지). withRLS가 이미 $transaction으로
// 감싸므로, 존재/삭제 확인을 통과한 뒤 하나라도 insert가 실패(RLS 등)하면 자동으로 전체
// 롤백된다 — 별도 트랜잭션 처리가 필요 없다.
export async function createPaymentRequestsBulk(
  ctx: RlsContext,
  requesterId: string,
  inputs: PaymentRequestCreateInput[],
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const payeeIds = [...new Set(inputs.map((i) => i.payeeId))];
    const payees = await tx.payee.findMany({
      where: { id: { in: payeeIds }, deletedAt: null },
      select: { id: true, bizName: true, taxType: true },
    });
    const payeeMap = new Map(payees.map((p) => [p.id, p]));
    if (payeeMap.size !== payeeIds.length) {
      return { ok: false, error: "선택한 사업자 중 존재하지 않거나 삭제된 항목이 있습니다. 다시 선택해 주세요." };
    }

    for (const input of inputs) {
      const payee = payeeMap.get(input.payeeId)!;
      const amount = (input.unitPrice + input.transportFee + input.materialFee) * input.count;
      await tx.paymentRequest.create({
        data: {
          requesterId,
          entity: input.entity,
          clientId: input.clientId,
          payeeId: input.payeeId,
          bizName: payee.bizName,
          unitPrice: input.unitPrice,
          transportFee: input.transportFee,
          materialFee: input.materialFee,
          count: input.count,
          amount,
          taxType: payee.taxType,
          memo: input.memo,
        },
      });
    }
    return { ok: true };
  });
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: PASS (기존 테스트 포함 전체)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat(payment-request): createPaymentRequestsBulk 데이터 계층 함수 추가"
```

---

## Task 5: 저장 서버 액션

**Files:**
- Modify: `src/app/(app)/expenses/actions.ts`

**Interfaces:**
- Consumes: `paymentRequestRowSchema`(Task 3), `createPaymentRequestsBulk`(Task 4), `PaymentRequestCreateInput`(Task 2).
- Produces: `createPaymentRequests(rows: PaymentRequestCreateInput[]): Promise<ActionState>` — Task 9(NewForm)가 클라이언트에서 직접 호출.
- 자동 테스트 없음(레포 관례상 `"use server"` 액션 자체는 세션 의존이라 유닛 테스트 대상 아님 — `saveExpense`도 동일) — Task 10 수동 검증에서 확인.

- [ ] **Step 1: 구현**

`src/app/(app)/expenses/actions.ts` 전체를 다음으로 교체:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { expenseSchema, paymentRequestRowSchema } from "@/lib/validation/schemas";
import { upsertExpense } from "@/lib/data/expenses";
import { createPaymentRequestsBulk } from "@/lib/data/payment-requests";
import type { PaymentRequestCreateInput } from "@/lib/payment-request-validation";
import { type ActionState, SAVED } from "@/lib/action-state";

export async function saveExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
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
  if (!result.ok) return result;
  revalidatePath("/expenses");
  return SAVED;
}

// PM 지급요청 등록 화면(행 편집기)의 여러 행을 한 번에 저장한다. FormData가 아니라 배열을 직접
// 받는 이유는 이 화면이 동적 행 개수를 다루는 표 편집기라 FormData로 표현하기 부적합하기 때문이다
// (다른 액션들과의 시그니처 차이는 이 화면의 특수성 때문). clientId RLS 위반(담당하지 않는
// 고객사)은 예상 가능한 보안 경계라 createPaymentRequestsBulk가 던지므로 여기서 잡아 일반
// 사용자 메시지로 바꾼다.
export async function createPaymentRequests(rows: PaymentRequestCreateInput[]): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "PM") return { ok: false, error: "권한이 없습니다." };

  const parsed = z.array(paymentRequestRowSchema).min(1).safeParse(rows);
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다." };

  const ctx = getRlsContext(user);
  try {
    const result = await createPaymentRequestsBulk(ctx, user.id, parsed.data);
    if (!result.ok) return result;
  } catch {
    return { ok: false, error: "저장 중 오류가 발생했습니다. 담당 고객사와 사업자 선택을 다시 확인해 주세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/expenses/actions.ts"
git commit -m "feat(payment-request): 등록 화면 저장 서버 액션 추가"
```

---

## Task 6: `PayeeCombobox` 개선 (정렬/높이/호버 툴팁/에러 테두리)

**Files:**
- Modify: `src/components/PayeeCombobox.tsx`

**Interfaces:**
- Consumes: `PayeeOption`(Task 1에서 `taxType` 추가됨), `taxTypeLabel`(`@/lib/labels`, 기존).
- Produces: `PayeeCombobox` props에 `hasError?: boolean` 추가 — Task 8(RowsTable)이 사용.
- 자동 테스트 없음(React 컴포넌트, 레포 관례) — Task 10 수동 검증.

- [ ] **Step 1: 구현**

`src/components/PayeeCombobox.tsx` 전체를 다음으로 교체:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { PayeeOption } from "@/lib/data/payees";
import { taxTypeLabel } from "@/lib/labels";

// 사업자명(이름) 검색형 선택. 동명이인/동일업체명 구분을 위해 후보 목록에는
// "이름 (고유번호)"를 보여주고, 선택하면 입력창에는 이름만 남긴다. 선택된 사업자가 있을 때
// 입력칸에 마우스를 올리면 그 사업자의 청구방식을 툴팁으로 보여준다(치우면 사라짐).
export function PayeeCombobox({
  payees,
  selectedId,
  onSelect,
  className = "w-full",
  hasError = false,
}: {
  payees: PayeeOption[];
  selectedId: string | null;
  onSelect: (payee: PayeeOption | null) => void;
  className?: string;
  hasError?: boolean;
}) {
  const selected = payees.find((p) => p.id === selectedId) ?? null;
  const [query, setQuery] = useState(selected?.bizName ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [hover, setHover] = useState(false);
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
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
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
        className={`w-full rounded border ${hasError ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"} px-2 py-1.5 text-sm`}
      />
      {hover && selected && (
        <div className="absolute -top-8 left-0 z-20 whitespace-nowrap rounded bg-[var(--color-fg)] px-2 py-1 text-xs text-[var(--color-surface)] shadow-lg">
          청구방식: {taxTypeLabel(selected.taxType)}
        </div>
      )}
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-96 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(p);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2 py-1.5 text-center text-sm hover:bg-[var(--color-border)] ${
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

변경 요약: 목록 항목 정렬 `text-left` → `text-center`, 드롭다운 `max-h-52` → `max-h-96`, `hasError` prop + 조건부 테두리 색, 호버 툴팁(`hover` 상태 + `taxTypeLabel`) 추가.

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (아직 `hasError`를 넘기는 곳이 없어 기본값 `false`로 동작)

- [ ] **Step 3: 커밋**

```bash
git add src/components/PayeeCombobox.tsx
git commit -m "feat(payment-request): 사업자명 콤보박스 정렬/높이/호버 툴팁 개선"
```

---

## Task 7: 고객사 콤보박스 신규 컴포넌트

**Files:**
- Create: `src/components/PaymentRequestClientCombobox.tsx`

**Interfaces:**
- Produces: `PaymentRequestClientCombobox({ clients, selectedId, onSelect, hasError, className })` — Task 8(RowsTable)이 사용. `onSelect: (client: {id:string; name:string} | null) => void`.
- 자동 테스트 없음(React 컴포넌트) — Task 10 수동 검증.

- [ ] **Step 1: 구현**

`src/components/PaymentRequestClientCombobox.tsx` 생성:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type ClientOption = { id: string; name: string };

// PM 지급요청 등록 화면의 고객사 검색형 선택. PayeeCombobox와 동일한 콜백 패턴이지만
// 필터바용 ClientCombobox(hidden input 패턴)와는 다른 용도라 별도 컴포넌트로 둔다.
// 등록된 고객사만 선택 가능 — 목록에 없는 이름을 입력하면 선택되지 않은 상태로 남는다
// (신규 고객사 자동 등록 없음, 저장 시 상위에서 검증으로 막는다).
export function PaymentRequestClientCombobox({
  clients,
  selectedId,
  onSelect,
  className = "w-full",
  hasError = false,
}: {
  clients: ClientOption[];
  selectedId: string | null;
  onSelect: (client: ClientOption | null) => void;
  className?: string;
  hasError?: boolean;
}) {
  const selected = clients.find((c) => c.id === selectedId) ?? null;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    setQuery(selected?.name ?? "");
    setOpen(false);
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function select(c: ClientOption) {
    setQuery(c.name);
    setOpen(false);
    onSelect(c);
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
        placeholder="고객사명 검색"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        className={`w-full rounded border ${hasError ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"} px-2 py-1.5 text-center text-sm`}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-96 w-full overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(c);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2 py-1.5 text-center text-sm hover:bg-[var(--color-border)] ${
                  i === highlight ? "bg-[var(--color-border)]" : ""
                }`}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/PaymentRequestClientCombobox.tsx
git commit -m "feat(payment-request): 고객사 자동완성 콤보박스 신규 추가"
```

---

## Task 8: `PaymentRequestRowsTable` 개편

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestRowsTable.tsx`

**Interfaces:**
- Consumes: `PayeeOption`(Task 1), `PayeeCombobox`(Task 6, `hasError` prop), `PaymentRequestClientCombobox`(Task 7), `PaymentRequestRowField`(Task 2, `@/lib/payment-request-validation`).
- Produces: `PaymentRequestRowsTable` props에 `rowErrors?: Map<string, Set<PaymentRequestRowField>>` 추가(기본값 `new Map()` — 이 태스크 단독으로도 타입 에러 없이 컴파일된다). Task 9(NewForm)가 실제 검증 결과를 전달. `DraftRow`/`newDraftRow`/`computeRowAmount`는 시그니처 변경 없이 그대로 export.
- 자동 테스트 없음(React 컴포넌트) — Task 10 수동 검증.

- [ ] **Step 1: 구현**

`src/app/(app)/expenses/PaymentRequestRowsTable.tsx` 전체를 다음으로 교체:

```tsx
"use client";

import { useState } from "react";
import type { TaxType } from "@prisma/client";
import type { PayeeOption } from "@/lib/data/payees";
import { PayeeCombobox } from "@/components/PayeeCombobox";
import { PaymentRequestClientCombobox } from "@/components/PaymentRequestClientCombobox";
import { PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL } from "@/lib/labels";
import { formatWon } from "@/lib/format";
import type { PaymentRequestRowField } from "@/lib/payment-request-validation";

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

function inputCls(hasError = false): string {
  const border = hasError ? "border-[var(--color-danger)]" : "border-[var(--color-border)]";
  return `w-full rounded border ${border} px-2 py-1.5 text-center text-sm`;
}

export function PaymentRequestRowsTable({
  rows,
  onRowsChange,
  clients,
  payees,
  rowErrors = new Map(),
}: {
  rows: DraftRow[];
  onRowsChange: (rows: DraftRow[]) => void;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  rowErrors?: Map<string, Set<PaymentRequestRowField>>;
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

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)));
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
              <th className="w-10 px-2 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체선택" />
              </th>
              <th className="w-24 px-2 py-2">지급명의</th>
              <th className="w-28 px-2 py-2">고객사</th>
              <th className="px-2 py-2">사업자명(이름)</th>
              <th className="w-28 px-2 py-2">단가</th>
              <th className="w-24 px-2 py-2">교통비</th>
              <th className="w-24 px-2 py-2">재료비</th>
              <th className="w-14 px-2 py-2">횟수</th>
              <th className="w-24 px-2 py-2">지급액</th>
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
                errors={rowErrors.get(row.key)}
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
  row, no, selected, onToggleSelect, onChange, onClientChange, clients, payees, errors,
}: {
  row: DraftRow;
  no: number;
  selected: boolean;
  onToggleSelect: () => void;
  onChange: (patch: Partial<DraftRow>) => void;
  onClientChange: (clientId: string) => void;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  errors?: Set<PaymentRequestRowField>;
}) {
  return (
    <tr className="border-b border-[var(--color-border)]">
      <td className={cellCls}><input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`${no}행 선택`} /></td>
      <td className={cellCls}>
        <select
          value={row.entity}
          onChange={(e) => onChange({ entity: e.target.value as DraftRow["entity"] })}
          className={inputCls(errors?.has("entity"))}
          style={{ textAlignLast: "center" }}
        >
          <option value="">선택</option>
          {PAYMENT_REQUEST_ENTITY_LABELS.map((label) => (
            <option key={label} value={PAYMENT_REQUEST_ENTITY_BY_LABEL[label]}>{label}</option>
          ))}
        </select>
      </td>
      <td className={cellCls}>
        <PaymentRequestClientCombobox
          clients={clients}
          selectedId={row.clientId || null}
          onSelect={(c) => onClientChange(c?.id ?? "")}
          hasError={errors?.has("clientId")}
        />
      </td>
      <td className={`${cellCls} min-w-[10rem]`}>
        <PayeeCombobox
          payees={payees}
          selectedId={row.payeeId}
          onSelect={(p) => onChange({ payeeId: p?.id ?? null, bizName: p?.bizName ?? "", taxType: p?.taxType ?? "" })}
          hasError={errors?.has("payeeId")}
        />
      </td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={row.unitPrice} onChange={(e) => onChange({ unitPrice: e.target.value.replace(/[^\d]/g, "") })} className={inputCls(errors?.has("unitPrice"))} placeholder="예: 50000" /></td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={row.transportFee} onChange={(e) => onChange({ transportFee: e.target.value.replace(/[^\d]/g, "") })} className={inputCls()} placeholder="예: 0" /></td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={row.materialFee} onChange={(e) => onChange({ materialFee: e.target.value.replace(/[^\d]/g, "") })} className={inputCls()} placeholder="예: 0" /></td>
      <td className={cellCls}><input type="text" inputMode="numeric" value={row.count} onChange={(e) => onChange({ count: e.target.value.replace(/[^\d]/g, "") })} className={inputCls(errors?.has("count"))} placeholder="예: 1" /></td>
      <td className={`${cellCls} font-medium`}>{formatWon(computeRowAmount(row))}</td>
      <td className={`${cellCls} min-w-[10rem]`}>
        <input type="text" value={row.memo} onChange={(e) => onChange({ memo: e.target.value })} placeholder="예: 7/30 테라리움 만들기 진행" className={inputCls()} />
      </td>
    </tr>
  );
}
```

변경 요약: No/청구방식 컬럼과 그 헤더·셀 제거(`TAX_TYPE_LABELS`/`TAX_TYPE_BY_LABEL`/`taxTypeLabel` import도 더 이상 쓰이지 않아 함께 제거), 단가 `w-20`→`w-28`, 교통비/재료비 `w-20`→`w-24`, 고객사 `<select>`→`PaymentRequestClientCombobox`, 사업자 선택 시 `taxType` 자동 반영, `inputCls`를 함수로 바꿔 에러 시 빨간 테두리, 단가/교통비/재료비/횟수 placeholder 추가, 지급명의 `<select>`에 `textAlignLast: "center"` 인라인 스타일 추가(브라우저별 완전히 동일하게 보이지 않을 수 있음, 설계 스펙에 명시된 한계).

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (`rowErrors`가 선택 prop이라 `PaymentRequestNewForm.tsx`를 아직 고치지 않아도 컴파일된다)

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestRowsTable.tsx"
git commit -m "feat(payment-request): 등록 표 컬럼 정리(No/청구방식 제거, 폭 조정, 고객사 자동완성, 에러 하이라이트)"
```

---

## Task 9: `PaymentRequestNewForm` 개편 (검증 → 저장 → 이동)

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestNewForm.tsx`

**Interfaces:**
- Consumes: `validateDraftRows`/`toPaymentRequestCreateInputs`(Task 2), `createPaymentRequests`(Task 5), `PaymentRequestRowsTable`의 `rowErrors` prop(Task 8).

- [ ] **Step 1: 구현**

`src/app/(app)/expenses/PaymentRequestNewForm.tsx` 전체를 다음으로 교체:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PayeeOption } from "@/lib/data/payees";
import { PaymentRequestRowsTable, newDraftRow, type DraftRow } from "./PaymentRequestRowsTable";
import { createPaymentRequests } from "./actions";
import { validateDraftRows, toPaymentRequestCreateInputs } from "@/lib/payment-request-validation";

// PM 전용 지급요청 등록 화면. 저장 전 클라이언트에서 행별 필수값을 먼저 검증해 하나라도
// 빠지면 전체 저장을 막고 문제 행을 강조한다. 통과하면 서버 액션을 호출하고, 성공하면
// 지급요청 목록 화면으로 이동한다(서버 액션은 ActionState만 반환하고 redirect는 하지 않음 —
// 화면 이동은 여기서 router.push로 직접 처리해 서버 액션 내 redirect()의 클라이언트 try/catch
// 오작동 위험을 피한다).
export function PaymentRequestNewForm({
  clients,
  payees,
}: {
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DraftRow[]>([newDraftRow()]);
  const [rowErrors, setRowErrors] = useState<ReturnType<typeof validateDraftRows>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    const errors = validateDraftRows(rows);
    if (errors.size > 0) {
      setRowErrors(errors);
      const firstBadIndex = rows.findIndex((r) => errors.has(r.key));
      setSaveError(`${firstBadIndex + 1}번째 행에 입력하지 않은 항목이 있습니다.`);
      return;
    }
    setRowErrors(new Map());
    setSaveError(null);
    setIsSaving(true);
    try {
      const result = await createPaymentRequests(toPaymentRequestCreateInputs(rows));
      if (!result.ok) {
        setSaveError(result.error ?? "저장에 실패했습니다.");
        return;
      }
      router.push("/expenses?tab=payment-request");
    } finally {
      setIsSaving(false);
    }
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
            엑셀 업로드
          </button>
          <Link href="/expenses?tab=payment-request" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            취소
          </Link>
          <button type="button" onClick={handleSave} disabled={isSaving} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-[var(--color-muted)]">
        지급 리스트에 등록된 대상은 사업자명(이름)에서 검색해 선택하세요. 지급 리스트에 없는 예외 건은
        &quot;엑셀 업로드&quot;로 등록합니다.
      </p>

      {saveError && <p className="mb-3 text-sm text-[var(--color-danger)]">{saveError}</p>}

      <PaymentRequestRowsTable rows={rows} onRowsChange={setRows} clients={clients} payees={payees} rowErrors={rowErrors} />
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestNewForm.tsx"
git commit -m "feat(payment-request): 등록 화면 저장 검증/서버 액션 연동 + 성공 시 목록 이동"
```

---

## Task 10: 수동 통합 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 개발 서버 기동**

Run: `npm run dev`

- [ ] **Step 2: PM 계정으로 `/expenses/payment-request/new` 접속 후 다음을 확인**

- No/청구방식 컬럼이 화면에서 사라짐.
- 단가/교통비/재료비/횟수 입력칸에 예시 placeholder가 보임 (단가 "예: 50000" 등).
- 단가에 "10000000"(천만원), 교통비/재료비에 "100000"(10만원) 입력해도 칸이 잘리지 않음.
- 단가/교통비/재료비/횟수를 하나씩 입력할 때마다 지급액이 즉시 갱신됨(기존 동작 유지 확인).
- 고객사 칸에 등록된 고객사 이름 일부를 입력하면 자동완성 목록이 뜨고, 선택하면 이름이 남음. 목록에 없는 이름을 입력하면 선택되지 않은 채로 남음.
- 사업자명(이름) 칸에 "더미" 검색 시 드롭다운이 스크롤 없이 여러 항목을 보여줌(높이 확장 확인), 목록 항목 텍스트가 가운데 정렬로 보임.
- 사업자를 선택한 뒤 그 입력칸에 마우스를 올리면 청구방식 툴팁이 뜨고, 마우스를 치우면 사라짐.
- 필수값(지급명의/고객사/사업자/단가/횟수) 중 하나라도 비운 채 "저장" 클릭 → 전체 저장이 차단되고, 안내 문구와 함께 문제 있는 칸이 빨간 테두리로 표시됨.
- 모든 필수값을 채우고 "저장" 클릭 → 지급요청 목록 화면(`/expenses?tab=payment-request`)으로 이동하고, 방금 등록한 건이 목록에 정확한 값(지급액 포함)으로 보임.
- PM이 담당하지 않는 고객사만 있는 상황을 재현하기 어렵다면 생략 가능(RLS 동작은 Task 4 통합 테스트로 이미 검증됨).

- [ ] **Step 3: 전체 테스트 스위트 + 타입 체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전체 PASS, 타입 에러 없음

- [ ] **Step 4: 최종 커밋(수정 사항이 있었다면)**

수동 검증 중 발견된 버그를 고쳤다면 그 변경만 별도로 커밋한다. 문제 없으면 커밋할 것 없음.
