# PM 엑셀 대량 등록 매칭 조건 완화 + 은행정보 스냅샷 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM 엑셀 대량 등록에서 청구방식/은행명/예금주를 "매칭되면 선택 입력(불일치 시 오류), 예외 건이면 필수"로 완화하고, `PaymentRequest`에 은행정보 스냅샷 컬럼을 추가해 정산담당자 다운로드가 예외 건에도 은행명/계좌번호/예금주를 채워서 보여주게 한다.

**Architecture:** `PaymentRequest`에 `bizName`/`taxType`와 동일한 성격의 스냅샷 컬럼 3개(`bankName`/`accountNumberEnc`/`accountHolder`)를 추가하고, 이 값을 채우는 4개 쓰기 경로(엑셀 업로드/PM 수동등록/정산담당자 인라인수정/PM 상세수정) 전부를 동일한 불변식으로 확장한다. 엑셀 업로드 경로만 매칭 성공 여부에 따른 조건부 필수/불일치오류 판정이 필요하고, 나머지 3개 경로는 항상 매칭 건(실제 payeeId)만 다루므로 Payee 값을 그대로 스냅샷한다. 정산담당자 다운로드는 이 3개 컬럼을 더 이상 Payee 조인이 아니라 `PaymentRequest` 자체에서 읽는다.

**Tech Stack:** Next.js App Router, Prisma + PostgreSQL(Supabase, RLS), zod, ExcelJS, Vitest.

## Global Constraints

- 청구방식/은행명/예금주 규칙: 매칭 시 선택 입력(입력했는데 Payee 실제 값과 다르면 해당 행 오류 → 업로드 전체 거부, all-or-nothing 유지). 매칭 안 됨(예외 건) 시 필수(비어있으면 오류).
- 계좌번호는 매칭 키이므로 위 규칙과 무관하게 항상 필수.
- `bankName`/`accountNumberEnc`/`accountHolder`는 `bizName`/`taxType`와 동일하게 다음 4개 경로 전부에서 Payee 스냅샷을 유지한다: `createPaymentRequestsFromUpload`, `createPaymentRequestsBulk`, `updatePaymentRequest`, `updatePaymentRequestPmFields`.
- 정산담당자 다운로드(`listPaymentRequestsForExport`)는 은행명/계좌번호/예금주를 `PaymentRequest` 자체에서 읽는다(더 이상 Payee 조인 아님). 고유번호/연락처/사업자번호는 계속 Payee 조인.
- `accountNumberEnc`는 Payee와 동일한 AES-GCM 암호화(`@/lib/crypto/payee-secret`의 `encrypt`/`decrypt`)를 쓴다.
- `npx prisma migrate dev`는 이 저장소에서 shadow DB 문제로 항상 깨진다 — 마이그레이션 SQL은 손으로 작성해 폴더에 배치하고 `npx prisma migrate deploy`로 적용한다(`npx prisma migrate dev` 절대 실행 금지).
- `test/global-setup.ts`가 `npx vitest run` 실행 시 `.env.test`가 가리키는 테스트 DB에 자동으로 `npx prisma migrate deploy`를 실행한다 — 테스트 실행 전 별도로 테스트 DB에 마이그레이션을 수동 적용할 필요 없음(Task 1에서 `.env`/Supabase에 적용하는 것과는 별개).
- 스펙 문서: `docs/superpowers/specs/2026-08-05-payment-request-upload-matching-design.md`

---

## Task 1: Prisma 스키마 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma` (301번째 줄, `PaymentRequest.bizName` 필드 다음)
- Create: `prisma/migrations/20260805040000_add_payment_request_snapshot_fields/migration.sql`

**Interfaces:**
- Produces: `PaymentRequest.bankName`/`accountNumberEnc`/`accountHolder`(모두 `String`, NOT NULL) — 이후 모든 태스크가 이 3개 컬럼을 읽고 쓴다.

- [ ] **Step 1: `prisma/schema.prisma` 수정**

301번째 줄(`bizName       String                                   // 사업자명(이름) 스냅샷`) 바로 다음, `unitPrice` 줄 앞에 삽입:

```prisma
  bankName      String                                   // 은행명 스냅샷(매칭 건=Payee 값, 예외 건=엑셀 입력값)
  accountNumberEnc String                                // 계좌번호 스냅샷(AES-GCM 암호문, Payee.accountNumberEnc와 동일 방식)
  accountHolder String                                   // 예금주 스냅샷
```

- [ ] **Step 2: 마이그레이션 SQL 작성**

디렉터리 `prisma/migrations/20260805040000_add_payment_request_snapshot_fields/`를 만들고 `migration.sql`을 작성:

```sql
-- 3단계 패턴(Payee.accountNumberBidx 작업과 동일): nullable 추가 → 백필 → NOT NULL 확정.
-- 기존 행은 전부 매칭 건(payeeId 보유)이 원칙이므로 연동된 Payee 값으로 백필한다.
-- payeeId가 없는(과거 예외 건) 행은 은행정보를 원래 저장한 적이 없으므로 빈 문자열로 채운다.

ALTER TABLE "PaymentRequest" ADD COLUMN "bankName" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN "accountNumberEnc" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN "accountHolder" TEXT;

UPDATE "PaymentRequest" pr
SET "bankName" = p."bankName", "accountNumberEnc" = p."accountNumberEnc", "accountHolder" = p."accountHolder"
FROM "Payee" p
WHERE pr."payeeId" = p."id";

UPDATE "PaymentRequest"
SET "bankName" = '', "accountNumberEnc" = '', "accountHolder" = ''
WHERE "bankName" IS NULL;

ALTER TABLE "PaymentRequest" ALTER COLUMN "bankName" SET NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "accountNumberEnc" SET NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "accountHolder" SET NOT NULL;
```

- [ ] **Step 3: 마이그레이션 적용 + 검증**

Run: `npx prisma migrate deploy`
Expected: `20260805040000_add_payment_request_snapshot_fields` 적용 성공 로그.

Run: `npx prisma migrate status`
Expected: `Database schema is up to date!`

Run: `npx prisma generate`
Expected: 성공(에러 없음). 만약 EPERM(Windows 파일 잠금) 에러가 나면, 실행 중인 `next dev` 프로세스가 파일을 잠그고 있을 가능성이 높다 — 이 경우 BLOCKED로 보고하고 컨트롤러가 처리하게 한다(직접 프로세스를 죽이려 하지 말 것).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260805040000_add_payment_request_snapshot_fields
git commit -m "feat(payment-request): 은행정보 스냅샷 컬럼 추가"
```

---

## Task 2: 테스트 헬퍼 `baseInput()` 갱신 (기존 테스트 스위트 그린 유지)

**Files:**
- Modify: `test/data-payment-requests.test.ts` (77-97번째 줄, `baseInput` 함수)

**Interfaces:**
- Consumes: `PaymentRequest.bankName`/`accountNumberEnc`/`accountHolder`(Task 1).
- Produces: `baseInput()`가 이 3개 필드를 기본값 포함해 반환 — 이후 태스크의 신규 테스트가 필요시 override로 명시적 값을 넘긴다.

Task 1의 마이그레이션으로 `PaymentRequest`에 NOT NULL 컬럼 3개가 추가됐으므로, 이 파일 전체에서 수십 번 쓰이는 `baseInput()`(직접 `tx.paymentRequest.create({ data: baseInput(...) })`로 쓰임)가 그대로면 모든 기존 테스트가 깨진다. 이 태스크는 그 회귀를 막는 순수 테스트 인프라 수정이다.

- [ ] **Step 1: `baseInput()` 수정**

`test/data-payment-requests.test.ts` 77-97번째 줄을 다음으로 교체:

```ts
function baseInput(overrides: Partial<{
  requesterId: string; entity: "HUNO" | "HUNO_INC"; clientId: string; bizName: string;
  bankName: string; accountNumberEnc: string; accountHolder: string;
  unitPrice: number; transportFee: number; materialFee: number; count: number;
  taxType: "TAX_INVOICE" | "BUSINESS_INCOME"; memo: string; payDate: Date | null; status: "PREPARING" | "COMPLETED";
}>) {
  return {
    requesterId: overrides.requesterId!,
    entity: overrides.entity ?? "HUNO",
    clientId: overrides.clientId!,
    bizName: overrides.bizName ?? "홍길동",
    bankName: overrides.bankName ?? "국민",
    accountNumberEnc: overrides.accountNumberEnc ?? encrypt("1101234567"),
    accountHolder: overrides.accountHolder ?? "예금주",
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
```

`encrypt`는 이미 이 파일 14번째 줄에서 import돼 있다(`import { encrypt, blindIndex, maskBizNumber, maskAccountNumber } from "@/lib/crypto/payee-secret";`) — 추가 import 불필요.

- [ ] **Step 2: 전체 기존 테스트가 여전히 통과하는지 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: 65개 중 55개 PASS, `createPaymentRequestsBulk`/`createPaymentRequestsFromUpload` describe 블록의 10개는 계속 FAIL — 두 함수는 아직 `bankName`/`accountNumberEnc`/`accountHolder`를 채우지 않아 NOT NULL 위반이 나는 게 정상이다(Task 5가 `createPaymentRequestsFromUpload`를, Task 6이 `createPaymentRequestsBulk`를 고친다). 이 10개 실패 외에 다른 실패가 있으면 BLOCKED로 보고할 것.

- [ ] **Step 3: Commit**

```bash
git add test/data-payment-requests.test.ts
git commit -m "test(payment-request): baseInput 헬퍼에 은행정보 스냅샷 기본값 추가"
```

---

## Task 3: 업로드 스키마 (`paymentRequestUploadRowSchema`)

**Files:**
- Modify: `src/lib/validation/schemas.ts` (162-176번째 줄)
- Test: `test/schemas.test.ts`

**Interfaces:**
- Produces: `paymentRequestUploadRowSchema`에 `bankName: string`(선택), `accountHolder: string`(선택) 필드 추가, `taxType`가 빈 문자열도 허용하도록 변경 — Task 4가 이 스키마를 그대로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/schemas.test.ts`의 `paymentRequestUploadRowSchema` describe 블록(332-395번째 줄)을 다음으로 교체:

```ts
describe("paymentRequestUploadRowSchema", () => {
  function row(overrides: Partial<{
    entity: string; clientName: string; bizName: string; accountNumber: string;
    bankName: string; accountHolder: string;
    unitPrice: string; transportFee: string; materialFee: string; count: string;
    taxType: string; memo: string;
  }> = {}) {
    return {
      entity: "휴노", clientName: "A사", bizName: "홍길동", accountNumber: "1101234567",
      bankName: "국민은행", accountHolder: "홍길동",
      unitPrice: "10000", transportFee: "0", materialFee: "0", count: "1",
      taxType: "세금계산서", memo: "",
      ...overrides,
    };
  }

  it("모든 필드가 채워지면 통과한다", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row()).success).toBe(true);
  });

  it("사업자명이 비어있으면 오류(매칭 성공 여부와 무관하게 항상 필수)", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ bizName: "" }));
    expect(result.success).toBe(false);
  });

  it("청구방식이 비어있어도 통과한다(매칭 성공 여부는 DB 조회 후에만 알 수 있음)", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ taxType: "" }));
    expect(result.success).toBe(true);
  });

  it("청구방식에 유효하지 않은 문자열을 넣으면 오류", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ taxType: "이상한값" }));
    expect(result.success).toBe(false);
  });

  it("은행명/예금주가 비어있어도 통과한다", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ bankName: "", accountHolder: "" }));
    expect(result.success).toBe(true);
  });

  it("계좌번호가 비어있으면 오류", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ accountNumber: "" }));
    expect(result.success).toBe(false);
  });

  it("계좌번호 형식이 9자리면 오류", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ accountNumber: "123456789" }));
    expect(result.success).toBe(false);
  });

  it("지급명의가 휴노/휴노INC가 아니면 오류", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row({ entity: "다른회사" })).success).toBe(false);
  });

  it("고객사명이 비어있으면 오류", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row({ clientName: "" })).success).toBe(false);
  });

  it("단가가 0이면 오류, 교통비/재료비는 0이어도 통과", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row({ unitPrice: "0" })).success).toBe(false);
    expect(paymentRequestUploadRowSchema.safeParse(row({ transportFee: "0", materialFee: "0" })).success).toBe(true);
  });

  it("횟수가 0이면 오류", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row({ count: "0" })).success).toBe(false);
  });

  it("교통비/재료비가 빈 문자열이면 0으로 처리된다", () => {
    const result = paymentRequestUploadRowSchema.safeParse(row({ transportFee: "", materialFee: "" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transportFee).toBe(0);
      expect(result.data.materialFee).toBe(0);
    }
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: FAIL — "청구방식이 비어있어도 통과한다" 등 새/변경된 케이스가 현재 스키마(청구방식 필수)와 맞지 않아 실패.

- [ ] **Step 3: 스키마 수정**

`src/lib/validation/schemas.ts` 162-176번째 줄을 다음으로 교체:

```ts
// PM 엑셀 대량 등록 한 행. 사업자명+계좌번호가 지급 리스트와 모두 일치하면 자동 연동되고
// (매칭된 Payee 값으로 서버가 덮어씀), 아니면 예외 건(신규 등록)으로 엑셀 값이 그대로 저장된다.
// 매칭 성공 여부는 DB 조회 후에만 알 수 있으므로, 이 스키마 단계에서는 조건부 없이 항상 검사한다.
// 청구방식/은행명/예금주는 매칭되면 자동 연동되므로 선택 입력(빈 문자열 허용) — 매칭 안 됐을 때만
// 필수라는 조건부 규칙은 DB 조회가 필요해 createPaymentRequestsFromUpload에서 판정한다.
export const paymentRequestUploadRowSchema = z.object({
  entity: z.enum(PAYMENT_REQUEST_ENTITY_LABELS),
  clientName: z.string().trim().min(1, "고객사명을 입력하세요."),
  bizName: z.string().trim().min(1, "사업자명을 입력하세요."),
  accountNumber: accountField,
  bankName: z.string().trim(),
  accountHolder: z.string().trim(),
  unitPrice: z.coerce.number().int().min(1),
  transportFee: z.coerce.number().int().min(0),
  materialFee: z.coerce.number().int().min(0),
  count: z.coerce.number().int().min(1),
  taxType: z.union([z.literal(""), z.enum(TAX_TYPE_LABELS)]),
  memo: z.string(),
});
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: PASS(전체).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/schemas.ts test/schemas.test.ts
git commit -m "feat(payment-request): 엑셀 업로드 스키마 청구방식/은행명/예금주 선택 입력으로 완화"
```

---

## Task 4: 파싱 (`payment-request-registration-upload.ts`)

**Files:**
- Modify: `src/lib/data/payment-request-registration-upload.ts`
- Test: `test/payment-request-registration-upload.test.ts`

**Interfaces:**
- Consumes: `paymentRequestUploadRowSchema`(Task 3, `bankName`/`accountHolder`/선택적 `taxType`).
- Produces: `ParsedRegistrationRow`에 `bankNameRaw: string`, `accountHolderRaw: string` 추가 — Task 5가 이 두 필드를 그대로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payment-request-registration-upload.test.ts`를 다음과 같이 수정:

1) 17-27번째 줄 "정상 행을 파싱한다" 테스트의 기대값에 `bankNameRaw`/`accountHolderRaw` 추가:

```ts
it("정상 행을 파싱한다", () => {
  const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow()]);
  expect(result.errors).toEqual([]);
  expect(result.rows).toEqual([{
    row: 2,
    data: {
      entity: "HUNO", clientName: "A사", bizNameRaw: "홍길동", accountNumberDigits: "1101234567",
      taxTypeRaw: "세금계산서", bankNameRaw: "국민은행", accountHolderRaw: "홍길동",
      unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "메모",
    },
  }]);
});
```

2) 42-46번째 줄 "청구방식이 없으면 오류"를 다음으로 교체(청구방식은 이제 파싱 단계에서 필수가 아님):

```ts
it("청구방식이 없어도 파싱은 통과한다(매칭 여부 판단은 이후 단계)", () => {
  const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "청구방식": "" })]);
  expect(result.errors).toEqual([]);
  expect(result.rows[0].data.taxTypeRaw).toBe("");
});

it("은행명/예금주가 없어도 파싱은 통과한다(매칭 여부 판단은 이후 단계)", () => {
  const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "은행명": "", "예금주": "" })]);
  expect(result.errors).toEqual([]);
  expect(result.rows[0].data.bankNameRaw).toBe("");
  expect(result.rows[0].data.accountHolderRaw).toBe("");
});
```

3) 84-88번째 줄 "은행명/예금주는 파싱 결과에 포함되지 않는다(참고용, 저장되지 않음)"를 다음으로 교체(이제 포함됨):

```ts
it("은행명/예금주가 파싱 결과에 포함된다", () => {
  const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow()]);
  expect(result.rows[0].data.bankNameRaw).toBe("국민은행");
  expect(result.rows[0].data.accountHolderRaw).toBe("홍길동");
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/payment-request-registration-upload.test.ts`
Expected: FAIL — `bankNameRaw`/`accountHolderRaw`가 아직 파싱 결과에 없어 여러 케이스 실패.

- [ ] **Step 3: 구현 수정**

`src/lib/data/payment-request-registration-upload.ts`에서 `ParsedRegistrationRow` 타입(13-26번째 줄)에 필드 추가:

```ts
export type ParsedRegistrationRow = {
  entity: PaymentRequestEntity;
  clientName: string;
  // 사업자명+계좌번호가 지급 리스트와 모두 일치하면 매칭된 Payee 값으로 덮어써지고(무시),
  // 매칭 실패 시 예외 건(신규 등록)으로 이 값이 그대로 저장된다 — 매칭 여부와 무관하게 항상 필수.
  bizNameRaw: string;
  accountNumberDigits: string;
  // taxTypeRaw/bankNameRaw/accountHolderRaw: 매칭되면 비어있어도 되고(Payee 값 자동 연동),
  // 값이 있는데 Payee 실제 값과 다르면 오류. 매칭 안 되면(예외 건) 셋 다 필수 — DB 조회가
  // 필요해 이 판정은 createPaymentRequestsFromUpload가 담당한다.
  taxTypeRaw: string;
  bankNameRaw: string;
  accountHolderRaw: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  memo: string;
};
```

`buildPaymentRequestRegistrationRowsFromXlsx`(35-97번째 줄)의 `safeParse` 호출과 결과 push를 수정:

```ts
    const parsed = paymentRequestUploadRowSchema.safeParse({
      entity: at(cells, "지급명의"),
      clientName: at(cells, "고객사명"),
      bizName: at(cells, "사업자명(이름)"),
      accountNumber: at(cells, "계좌번호"),
      bankName: at(cells, "은행명"),
      accountHolder: at(cells, "예금주"),
      unitPrice: at(cells, "단가"),
      transportFee: at(cells, "교통비"),
      materialFee: at(cells, "재료비"),
      count: at(cells, "횟수"),
      taxType: at(cells, "청구방식"),
      memo: at(cells, "상세내역"),
    });
    if (!parsed.success) {
      result.errors.push({ row: r + 1, message: parsed.error.issues[0]?.message ?? "형식 오류" });
      continue;
    }

    const d = parsed.data;
    result.rows.push({
      row: r + 1,
      data: {
        entity: PAYMENT_REQUEST_ENTITY_BY_LABEL[d.entity],
        clientName: d.clientName,
        bizNameRaw: d.bizName,
        accountNumberDigits: digitsOnly(d.accountNumber),
        taxTypeRaw: d.taxType,
        bankNameRaw: d.bankName,
        accountHolderRaw: d.accountHolder,
        unitPrice: d.unitPrice,
        transportFee: d.transportFee,
        materialFee: d.materialFee,
        count: d.count,
        memo: d.memo,
      },
    });
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/payment-request-registration-upload.test.ts`
Expected: PASS(전체).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/payment-request-registration-upload.ts test/payment-request-registration-upload.test.ts
git commit -m "feat(payment-request): 엑셀 업로드 파싱에 은행명/예금주 컬럼 반영"
```

---

## Task 5: 매칭/저장 로직 (`createPaymentRequestsFromUpload`)

**Files:**
- Modify: `src/lib/data/payment-requests.ts`
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: `ParsedRegistrationRow.taxTypeRaw`/`bankNameRaw`/`accountHolderRaw`(Task 4), `PaymentRequest.bankName`/`accountNumberEnc`/`accountHolder`(Task 1).
- Produces: `createPaymentRequestsFromUpload`가 매칭 건은 Payee 스냅샷, 예외 건은 엑셀 입력값을 `bankName`/`accountNumberEnc`/`accountHolder`에 저장 — 반환 타입(`PaymentRequestUploadCreateResult`)은 변경 없음.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-requests.test.ts` 상단 import에 `decrypt` 추가(14번째 줄):

```ts
import { encrypt, decrypt, blindIndex, maskBizNumber, maskAccountNumber } from "@/lib/crypto/payee-secret";
```

`createPaymentRequestsFromUpload` describe 블록(843-1011번째 줄)의 `uploadRow` 헬퍼(844-861번째 줄)를 다음으로 교체(은행명/예금주 기본값을 `createPayee`가 항상 만드는 Payee 값 "국민"/"예금주"와 일치시켜, 매칭 테스트가 새 불일치 검사에 걸리지 않게 한다):

```ts
    function uploadRow(row: number, overrides: Partial<ParsedRegistrationRow> = {}) {
      return {
        row,
        data: {
          entity: "HUNO" as const,
          clientName: "A사",
          bizNameRaw: "홍길동",
          accountNumberDigits: "9990001112",
          taxTypeRaw: "세금계산서",
          bankNameRaw: "국민",
          accountHolderRaw: "예금주",
          unitPrice: 10000,
          transportFee: 0,
          materialFee: 0,
          count: 1,
          memo: "",
          ...overrides,
        },
      };
    }
```

878-893번째 줄의 테스트 "매칭된 행은 엑셀에 적힌 청구방식이 달라도 Payee의 실제 청구방식을 저장한다"(현재: 불일치를 조용히 덮어씀)를 다음 두 테스트로 교체(신규 규칙: 불일치는 오류):

```ts
    it("매칭된 행에 엑셀 청구방식이 Payee 실제 값과 다르면 오류를 반환하고 미저장한다", async () => {
      const { pmA, clientA } = await seed();
      await createPayee("1111111111", "업체A", "BUSINESS_INCOME", "5551112223");

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, {
          clientName: clientA.name, bizNameRaw: "업체A", accountNumberDigits: "5551112223",
          taxTypeRaw: "세금계산서",
        }),
      ]);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("매칭된 행에 청구방식을 비워두면 Payee의 실제 청구방식을 자동 연동한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1111111111", "업체A", "BUSINESS_INCOME", "5551112223");

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, {
          clientName: clientA.name, bizNameRaw: "업체A", accountNumberDigits: "5551112223",
          taxTypeRaw: "",
        }),
      ]);
      expect(result).toEqual({ ok: true, created: 1 });

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.payeeId).toBe(payee.id);
      expect(row.taxType).toBe("BUSINESS_INCOME");
    });
```

1010번째 줄(`describe("createPaymentRequestsFromUpload"...)` 블록의 마지막 `it` 다음, 블록을 닫는 `});` 바로 앞)에 다음 테스트들을 추가:

```ts
    it("매칭된 행에 은행명이 Payee 실제 값과 다르면 오류를 반환하고 미저장한다", async () => {
      const { pmA, clientA } = await seed();
      await createPayee("1111111111", "업체A", "TAX_INVOICE", "5551112223");

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, {
          clientName: clientA.name, bizNameRaw: "업체A", accountNumberDigits: "5551112223",
          bankNameRaw: "다른은행",
        }),
      ]);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("예외 건인데 청구방식/은행명/예금주 중 하나라도 비어있으면 오류를 반환하고 미저장한다", async () => {
      const { pmA, clientA } = await seed();

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: clientA.name, bizNameRaw: "신규대상", bankNameRaw: "" }),
      ]);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("예외 건은 엑셀에 입력한 은행명/계좌번호/예금주를 그대로 암호화해 저장한다", async () => {
      const { pmA, clientA } = await seed();

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, {
          clientName: clientA.name, bizNameRaw: "신규대상", accountNumberDigits: "7778889990",
          bankNameRaw: "신한은행", accountHolderRaw: "김신규",
        }),
      ]);
      expect(result).toEqual({ ok: true, created: 1 });

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      const saved = await withRLS(ADMIN, (tx) => tx.paymentRequest.findUniqueOrThrow({
        where: { id: row.id },
        select: { bankName: true, accountNumberEnc: true, accountHolder: true },
      }));
      expect(saved.bankName).toBe("신한은행");
      expect(saved.accountHolder).toBe("김신규");
      expect(decrypt(saved.accountNumberEnc)).toBe("7778889990");
    });

    it("매칭된 행은 은행명/계좌번호/예금주도 Payee 스냅샷으로 저장한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1111111111", "업체A", "TAX_INVOICE", "5551112223");

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: clientA.name, bizNameRaw: "업체A", accountNumberDigits: "5551112223" }),
      ]);
      expect(result).toEqual({ ok: true, created: 1 });

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      const saved = await withRLS(ADMIN, (tx) => tx.paymentRequest.findUniqueOrThrow({
        where: { id: row.id },
        select: { bankName: true, accountNumberEnc: true, accountHolder: true },
      }));
      expect(payee.bankName).toBe("국민");
      expect(saved.bankName).toBe("국민");
      expect(saved.accountHolder).toBe("예금주");
      expect(decrypt(saved.accountNumberEnc)).toBe("5551112223");
    });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts -t createPaymentRequestsFromUpload`
Expected: FAIL — 청구방식 불일치가 아직 오류로 처리되지 않고, `bankName`/`accountNumberEnc`/`accountHolder`가 아직 저장되지 않아 다수 실패.

- [ ] **Step 3: 구현 수정**

`src/lib/data/payment-requests.ts` 상단 import 수정:

```ts
import { decrypt, blindIndex, encrypt } from "@/lib/crypto/payee-secret";
import { TAX_TYPE_BY_LABEL, taxTypeLabel } from "@/lib/labels";
```

`createPaymentRequestsFromUpload` 함수(483번째 줄부터) 바로 앞에 헬퍼 함수를 추가:

```ts
// 청구방식/은행명/예금주 공통 판정. 매칭된 Payee 값이 있으면: 엑셀 값이 비어있으면 그 값을
// 쓰고(자동 연동), 엑셀 값이 있는데 다르면 오류. 매칭이 안 됐으면(payeeValue===null): 엑셀
// 값이 필수(비어있으면 오류).
function resolveMatchedField(
  raw: string,
  payeeValue: string | null,
  fieldLabel: string,
): { value: string } | { error: string } {
  if (payeeValue !== null) {
    if (raw === "" || raw === payeeValue) return { value: payeeValue };
    return { error: `${fieldLabel}이(가) 지급 리스트와 일치하지 않습니다.` };
  }
  if (raw === "") return { error: `${fieldLabel}을(를) 입력하세요(지급 리스트에 없는 경우 필수).` };
  return { value: raw };
}
```

`createPaymentRequestsFromUpload` 함수 전체(483-577번째 줄)를 다음으로 교체:

```ts
export async function createPaymentRequestsFromUpload(
  ctx: RlsContext,
  requesterId: string,
  rows: { row: number; data: ParsedRegistrationRow }[],
): Promise<PaymentRequestUploadCreateResult> {
  return withRLS(ctx, async (tx) => {
    const errors: { row: number; message: string }[] = [];
    const resolved: {
      entity: PaymentRequestEntity; clientId: string; payeeId: string | null;
      bizName: string; taxType: TaxType; bankName: string; accountNumberEnc: string; accountHolder: string;
      unitPrice: number; transportFee: number; materialFee: number; count: number; memo: string;
    }[] = [];

    const clientNames = [...new Set(rows.map((r) => r.data.clientName))];
    const clientsByName = new Map<string, { id: string }[]>();
    if (clientNames.length > 0) {
      const clients = await tx.client.findMany({
        where: { name: { in: clientNames }, deletedAt: null },
        select: { id: true, name: true },
      });
      for (const c of clients) {
        const list = clientsByName.get(c.name);
        if (list) list.push({ id: c.id });
        else clientsByName.set(c.name, [{ id: c.id }]);
      }
    }

    const accountBidxList = [...new Set(rows.map((r) => blindIndex(r.data.accountNumberDigits)))];
    const payeesByAccountBidx = new Map<string, {
      id: string; bizName: string; taxType: TaxType; bankName: string; accountNumberEnc: string; accountHolder: string;
    }[]>();
    if (accountBidxList.length > 0) {
      const payees = await tx.payee.findMany({
        where: { accountNumberBidx: { in: accountBidxList }, deletedAt: null },
        select: { id: true, accountNumberBidx: true, bizName: true, taxType: true, bankName: true, accountNumberEnc: true, accountHolder: true },
      });
      for (const p of payees) {
        const list = payeesByAccountBidx.get(p.accountNumberBidx);
        const entry = {
          id: p.id, bizName: p.bizName, taxType: p.taxType,
          bankName: p.bankName, accountNumberEnc: p.accountNumberEnc, accountHolder: p.accountHolder,
        };
        if (list) list.push(entry);
        else payeesByAccountBidx.set(p.accountNumberBidx, [entry]);
      }
    }

    for (const { row, data } of rows) {
      const clients = clientsByName.get(data.clientName) ?? [];
      if (clients.length === 0) {
        errors.push({ row, message: `등록되지 않은 고객사명입니다: ${data.clientName}` });
        continue;
      }
      if (clients.length > 1) {
        errors.push({ row, message: `동일한 이름의 고객사가 여러 건 있어 자동 선택할 수 없습니다: ${data.clientName}` });
        continue;
      }

      const candidates = payeesByAccountBidx.get(blindIndex(data.accountNumberDigits)) ?? [];
      const matches = candidates.filter((c) => c.bizName === data.bizNameRaw);
      if (matches.length > 1) {
        errors.push({ row, message: "사업자명과 계좌번호가 여러 지급 대상과 일치해 자동 선택할 수 없습니다." });
        continue;
      }
      const payee = matches[0] ?? null;

      const taxTypeResult = resolveMatchedField(data.taxTypeRaw, payee ? taxTypeLabel(payee.taxType) : null, "청구방식");
      const bankNameResult = resolveMatchedField(data.bankNameRaw, payee ? payee.bankName : null, "은행명");
      const accountHolderResult = resolveMatchedField(data.accountHolderRaw, payee ? payee.accountHolder : null, "예금주");
      if ("error" in taxTypeResult) { errors.push({ row, message: taxTypeResult.error }); continue; }
      if ("error" in bankNameResult) { errors.push({ row, message: bankNameResult.error }); continue; }
      if ("error" in accountHolderResult) { errors.push({ row, message: accountHolderResult.error }); continue; }

      resolved.push({
        entity: data.entity,
        clientId: clients[0].id,
        payeeId: payee?.id ?? null,
        bizName: payee?.bizName ?? data.bizNameRaw,
        taxType: TAX_TYPE_BY_LABEL[taxTypeResult.value as keyof typeof TAX_TYPE_BY_LABEL],
        bankName: bankNameResult.value,
        accountNumberEnc: payee ? payee.accountNumberEnc : encrypt(data.accountNumberDigits),
        accountHolder: accountHolderResult.value,
        unitPrice: data.unitPrice,
        transportFee: data.transportFee,
        materialFee: data.materialFee,
        count: data.count,
        memo: data.memo,
      });
    }

    if (errors.length > 0) return { ok: false, errors };

    for (const r of resolved) {
      const amount = (r.unitPrice + r.transportFee + r.materialFee) * r.count;
      await tx.paymentRequest.create({
        data: {
          requesterId, entity: r.entity, clientId: r.clientId, payeeId: r.payeeId,
          bizName: r.bizName, unitPrice: r.unitPrice, transportFee: r.transportFee,
          materialFee: r.materialFee, count: r.count, amount, taxType: r.taxType, memo: r.memo,
          bankName: r.bankName, accountNumberEnc: r.accountNumberEnc, accountHolder: r.accountHolder,
        },
      });
    }
    return { ok: true, created: resolved.length };
  });
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: `createPaymentRequestsFromUpload` describe 블록(이번에 추가/교체한 테스트 포함)은 전부 PASS. `createPaymentRequestsBulk` describe 블록의 3개 테스트는 Task 6이 아직 실행되지 않아 계속 FAIL이 정상이다(그 함수는 아직 은행정보를 채우지 않음). 그 3개 외에 다른 실패가 있으면 BLOCKED로 보고할 것.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat(payment-request): 엑셀 업로드 매칭 시 청구방식/은행명/예금주 조건부 필수+불일치 오류 적용"
```

---

## Task 6: 나머지 3개 스냅샷 경로

**Files:**
- Modify: `src/lib/data/payment-requests.ts`
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: `PaymentRequest.bankName`/`accountNumberEnc`/`accountHolder`(Task 1), `decrypt`(이미 Task 5에서 이 테스트 파일에 import됨).
- Produces: `createPaymentRequestsBulk`/`updatePaymentRequest`/`updatePaymentRequestPmFields` 셋 다 은행정보를 `bizName`/`taxType`와 동일하게 스냅샷.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-requests.test.ts`의 `createPaymentRequestsBulk` describe 블록(307-374번째 줄) 마지막 `it`("여러 행을 한 번에 저장한다") 다음에 추가:

```ts
    it("선택한 사업자의 은행명/계좌번호/예금주도 스냅샷으로 저장한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1234567890", "업체A", "TAX_INVOICE");
      const input: PaymentRequestCreateInput = {
        entity: "HUNO", clientId: clientA.id, payeeId: payee.id,
        unitPrice: 100000, transportFee: 0, materialFee: 0, count: 1, memo: "",
      };
      const result = await createPaymentRequestsBulk({ userId: pmA.id, role: "PM" }, pmA.id, [input]);
      expect(result.ok).toBe(true);

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      const saved = await withRLS(ADMIN, (tx) => tx.paymentRequest.findUniqueOrThrow({
        where: { id: row.id },
        select: { bankName: true, accountNumberEnc: true, accountHolder: true },
      }));
      expect(saved.bankName).toBe("국민");
      expect(saved.accountHolder).toBe("예금주");
      expect(decrypt(saved.accountNumberEnc)).toBe("1234567890");
    });
```

`updatePaymentRequest (정산담당자 인라인 수정)` describe 블록(567-648번째 줄) 마지막 `it` 다음에 추가:

```ts
    it("payeeId를 재선택하면 은행명/계좌번호/예금주도 새 Payee 값으로 갱신된다", async () => {
      const { pmA, clientA, clientB } = await seed();
      const oldPayee = await createPayee("1111111111", "이전사업자", "TAX_INVOICE", "1101234567");
      const newPayee = await createPayee("2222222222", "새사업자", "BUSINESS_INCOME", "9998887776");
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "이전사업자" }), payeeId: oldPayee.id },
      }));

      const result = await updatePaymentRequest(ADMIN, created.id, {
        entity: "HUNO_INC", clientId: clientB.id, payeeId: newPayee.id,
        payDate: new Date("2026-08-10"), status: "COMPLETED",
      });
      expect(result.ok).toBe(true);

      const saved = await withRLS(ADMIN, (tx) => tx.paymentRequest.findUniqueOrThrow({
        where: { id: created.id },
        select: { bankName: true, accountNumberEnc: true, accountHolder: true },
      }));
      expect(saved.bankName).toBe("국민");
      expect(saved.accountHolder).toBe("예금주");
      expect(decrypt(saved.accountNumberEnc)).toBe("9998887776");
    });
```

`updatePaymentRequestPmFields (PM 상세수정)` describe 블록(650-741번째 줄) 마지막 `it` 다음에 추가:

```ts
    it("payeeId를 재선택하면 은행명/계좌번호/예금주도 새 Payee 값으로 갱신된다", async () => {
      const { pmA, clientA } = await seed();
      const clientC = await withRLS(ADMIN, (tx) => tx.client.create({
        data: { name: "C사", businessType: "휴노", managers: { create: [{ userId: pmA.id }] } },
      }));
      const oldPayee = await createPayee("1111111111", "이전사업자", "TAX_INVOICE", "1101234567");
      const newPayee = await createPayee("2222222222", "새사업자", "BUSINESS_INCOME", "9998887776");
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, unitPrice: 10000, count: 1 }), payeeId: oldPayee.id },
      }));

      const result = await updatePaymentRequestPmFields({ userId: pmA.id, role: "PM" }, created.id, {
        entity: "HUNO_INC", clientId: clientC.id, payeeId: newPayee.id,
        unitPrice: 100000, transportFee: 0, materialFee: 0, count: 1, memo: "메모",
      });
      expect(result.ok).toBe(true);

      const saved = await withRLS(ADMIN, (tx) => tx.paymentRequest.findUniqueOrThrow({
        where: { id: created.id },
        select: { bankName: true, accountNumberEnc: true, accountHolder: true },
      }));
      expect(saved.bankName).toBe("국민");
      expect(saved.accountHolder).toBe("예금주");
      expect(decrypt(saved.accountNumberEnc)).toBe("9998887776");
    });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts -t "은행명/계좌번호/예금주"`
Expected: FAIL — 세 함수 모두 아직 은행정보를 스냅샷하지 않아 `saved.bankName`이 빈 문자열 등으로 실패.

- [ ] **Step 3: 구현 수정**

`createPaymentRequestsBulk`(218-256번째 줄)를 다음으로 교체:

```ts
export async function createPaymentRequestsBulk(
  ctx: RlsContext,
  requesterId: string,
  inputs: PaymentRequestCreateInput[],
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const payeeIds = [...new Set(inputs.map((i) => i.payeeId))];
    const payees = await tx.payee.findMany({
      where: { id: { in: payeeIds }, deletedAt: null },
      select: { id: true, bizName: true, taxType: true, bankName: true, accountNumberEnc: true, accountHolder: true },
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
          requesterId, entity: input.entity, clientId: input.clientId, payeeId: input.payeeId,
          bizName: payee.bizName, unitPrice: input.unitPrice, transportFee: input.transportFee,
          materialFee: input.materialFee, count: input.count, amount, taxType: payee.taxType, memo: input.memo,
          bankName: payee.bankName, accountNumberEnc: payee.accountNumberEnc, accountHolder: payee.accountHolder,
        },
      });
    }
    return { ok: true };
  });
}
```

`updatePaymentRequest`(307-348번째 줄)를 다음으로 교체:

```ts
export async function updatePaymentRequest(
  ctx: RlsContext,
  id: string,
  input: PaymentRequestSettlementUpdateInput,
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const current = await tx.paymentRequest.findFirst({
      where: { id, deletedAt: null },
      select: { payeeId: true, bizName: true, taxType: true, bankName: true, accountNumberEnc: true, accountHolder: true },
    });
    if (!current) return { ok: false, error: "수정할 항목을 찾을 수 없습니다." };

    let bizName: string;
    let taxType: TaxType;
    let bankName: string;
    let accountNumberEnc: string;
    let accountHolder: string;
    if (input.payeeId === current.payeeId) {
      bizName = current.bizName;
      taxType = current.taxType;
      bankName = current.bankName;
      accountNumberEnc = current.accountNumberEnc;
      accountHolder = current.accountHolder;
    } else {
      const payee = await tx.payee.findFirst({
        where: { id: input.payeeId, deletedAt: null },
        select: { bizName: true, taxType: true, bankName: true, accountNumberEnc: true, accountHolder: true },
      });
      if (!payee) return { ok: false, error: "선택한 사업자를 찾을 수 없습니다. 다시 선택해 주세요." };
      bizName = payee.bizName;
      taxType = payee.taxType;
      bankName = payee.bankName;
      accountNumberEnc = payee.accountNumberEnc;
      accountHolder = payee.accountHolder;
    }

    await tx.paymentRequest.update({
      where: { id },
      data: {
        entity: input.entity,
        clientId: input.clientId,
        payeeId: input.payeeId,
        bizName,
        taxType,
        bankName,
        accountNumberEnc,
        accountHolder,
        payDate: input.payDate,
        status: input.status,
      },
    });
    return { ok: true };
  });
}
```

`updatePaymentRequestPmFields`(365-415번째 줄)를 다음으로 교체:

```ts
export async function updatePaymentRequestPmFields(
  ctx: RlsContext,
  id: string,
  input: PaymentRequestPmUpdateInput,
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const current = await tx.paymentRequest.findFirst({
      where: { id, deletedAt: null },
      select: { status: true, requesterId: true, payeeId: true, bizName: true, taxType: true, bankName: true, accountNumberEnc: true, accountHolder: true },
    });
    if (!current || current.status !== "PREPARING" || current.requesterId !== ctx.userId) {
      return { ok: false, error: "수정할 수 없는 건입니다." };
    }

    let bizName: string;
    let taxType: TaxType;
    let bankName: string;
    let accountNumberEnc: string;
    let accountHolder: string;
    if (input.payeeId === current.payeeId) {
      bizName = current.bizName;
      taxType = current.taxType;
      bankName = current.bankName;
      accountNumberEnc = current.accountNumberEnc;
      accountHolder = current.accountHolder;
    } else {
      const payee = await tx.payee.findFirst({
        where: { id: input.payeeId, deletedAt: null },
        select: { bizName: true, taxType: true, bankName: true, accountNumberEnc: true, accountHolder: true },
      });
      if (!payee) return { ok: false, error: "선택한 사업자를 찾을 수 없습니다. 다시 선택해 주세요." };
      bizName = payee.bizName;
      taxType = payee.taxType;
      bankName = payee.bankName;
      accountNumberEnc = payee.accountNumberEnc;
      accountHolder = payee.accountHolder;
    }

    const amount = (input.unitPrice + input.transportFee + input.materialFee) * input.count;
    await tx.paymentRequest.update({
      where: { id },
      data: {
        entity: input.entity,
        clientId: input.clientId,
        payeeId: input.payeeId,
        bizName,
        taxType,
        bankName,
        accountNumberEnc,
        accountHolder,
        unitPrice: input.unitPrice,
        transportFee: input.transportFee,
        materialFee: input.materialFee,
        count: input.count,
        amount,
        memo: input.memo,
      },
    });
    return { ok: true };
  });
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: PASS(전체).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat(payment-request): PM 수동등록/인라인수정/PM상세수정에도 은행정보 스냅샷 적용"
```

---

## Task 7: 정산담당자 다운로드 (`listPaymentRequestsForExport`)

**Files:**
- Modify: `src/lib/data/payment-requests.ts` (143-211번째 줄)
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: `PaymentRequest.bankName`/`accountNumberEnc`/`accountHolder`(Task 1), `decrypt`/`encrypt`(이미 import됨).
- Produces: `listPaymentRequestsForExport`가 반환하는 `PaymentRequestExportRow.bankName`/`accountNumber`/`accountHolder`를 이제 `PaymentRequest` 자체에서 읽음(타입 자체는 변경 없음).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-requests.test.ts`의 `listPaymentRequestsForExport` describe 블록(376-462번째 줄) 안, 401-415번째 줄 "연동된 Payee의 지급 리스트 정보를 원문으로 포함한다"를 다음으로 교체:

```ts
    it("연동된 Payee의 지급 리스트 정보를 원문으로 포함한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1101234567", "김강사", "BUSINESS_INCOME");
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: {
          ...baseInput({
            requesterId: pmA.id, clientId: clientA.id, bizName: "김강사",
            bankName: "국민", accountNumberEnc: encrypt("110123456789"), accountHolder: "예금주",
          }),
          payeeId: payee.id,
        },
      }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.payeeKeyId).toBe(payee.keyId);
      expect(row.phone).toBe("010-1234-5678");
      expect(row.bizNumber).toBe("1101234567");
      expect(row.bankName).toBe("국민");
      expect(row.accountNumber).toBe("110123456789");
      expect(row.accountHolder).toBe("예금주");
    });
```

417-430번째 줄 "payeeId가 없는 건은 지급 리스트 연동 컬럼이 빈 문자열이다"를 다음으로 교체(은행정보는 이제 스냅샷이라 예외 건도 채워짐):

```ts
    it("payeeId가 없는 건은 고유번호/연락처/사업자번호만 빈 문자열이고, 은행명/계좌번호/예금주는 스냅샷 값 그대로 나온다", async () => {
      const { pmA, clientA } = await seed();
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: baseInput({
          requesterId: pmA.id, clientId: clientA.id, bizName: "예외건",
          bankName: "신한은행", accountNumberEnc: encrypt("7778889990"), accountHolder: "김신규",
        }),
      }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.payeeKeyId).toBe("");
      expect(row.phone).toBe("");
      expect(row.bizNumber).toBe("");
      expect(row.bankName).toBe("신한은행");
      expect(row.accountNumber).toBe("7778889990");
      expect(row.accountHolder).toBe("김신규");
    });
```

432-446번째 줄 "사업자명·청구방식은 등록 시점 스냅샷을 그대로 사용한다(Payee 최신값 아님)" 다음에 다음 테스트를 추가:

```ts
    it("은행명·계좌번호·예금주도 등록 시점 스냅샷을 그대로 사용한다(Payee 최신값 아님)", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1101234567", "김강사", "TAX_INVOICE");
      await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: {
          ...baseInput({
            requesterId: pmA.id, clientId: clientA.id, bizName: "김강사",
            bankName: "국민", accountNumberEnc: encrypt("110123456789"), accountHolder: "예금주",
          }),
          payeeId: payee.id,
        },
      }));
      await withRLS(ADMIN, (tx) => tx.payee.update({
        where: { id: payee.id },
        data: { bankName: "바뀐은행", accountNumberEnc: encrypt("999999999999"), accountHolder: "바뀐예금주" },
      }));

      const [row] = await listPaymentRequestsForExport(ADMIN);
      expect(row.bankName).toBe("국민");
      expect(row.accountNumber).toBe("110123456789");
      expect(row.accountHolder).toBe("예금주");
    });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts -t listPaymentRequestsForExport`
Expected: FAIL — 아직 Payee 조인에서 은행정보를 읽고 있어 "payeeId가 없는 건" 테스트가 빈 문자열을 기대하지 않는 새 기대값과 어긋나고, 스냅샷 테스트도 실패.

- [ ] **Step 3: 구현 수정**

`listPaymentRequestsForExport`(143-211번째 줄 중 166-211번째 줄 부분, 주석 포함)를 다음으로 교체:

```ts
// 엑셀 다운로드 전용. ids가 있으면 필터 없이 해당 건만(체크박스 선택), 없으면 필터링된 전체
// 결과를 페이지네이션 없이 반환한다. 사업자명/청구방식/은행명/계좌번호/예금주는 모두
// PaymentRequest 스냅샷을 그대로 쓴다(매칭 여부와 무관하게 항상 채워짐 — payeeId가 없는
// 예외 건도 값이 채워진다). 고유번호/연락처/사업자번호만 연동된 Payee에서 조회하며,
// payeeId가 없는 건은 빈 문자열로 채운다. role 체크는 호출부(export 라우트)가 담당한다.
export async function listPaymentRequestsForExport(
  ctx: RlsContext,
  filter?: PaymentRequestFilter,
  ids?: string[],
): Promise<PaymentRequestExportRow[]> {
  const where: Prisma.PaymentRequestWhereInput = ids && ids.length > 0
    ? { id: { in: ids }, deletedAt: null }
    : buildWhere(filter);

  const rows = await withRLS(ctx, (tx) => tx.paymentRequest.findMany({
    where,
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    include: {
      requester: { select: { name: true, email: true } },
      client: { select: { name: true } },
      payee: { select: { keyId: true, phone: true, bizNumberEnc: true } },
    },
  }));

  return rows.map((r) => ({
    seqNo: r.seqNo,
    requesterName: r.requester.name ?? r.requester.email,
    entity: r.entity,
    clientName: r.client.name,
    bizName: r.bizName,
    payeeKeyId: r.payee?.keyId ?? "",
    phone: r.payee?.phone ?? "",
    bizNumber: r.payee ? decrypt(r.payee.bizNumberEnc) : "",
    bankName: r.bankName,
    accountNumber: decrypt(r.accountNumberEnc),
    accountHolder: r.accountHolder,
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
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: PASS(전체).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat(payment-request): 정산담당자 다운로드가 은행정보를 PaymentRequest 스냅샷에서 읽도록 변경"
```

---

## Task 8: 등록 양식 UI (안내 문구 + 드롭다운)

**Files:**
- Modify: `src/app/(app)/expenses/payment-request/xlsx.ts`
- Test: `test/payment-request-xlsx.test.ts`

**Interfaces:**
- 없음(이 태스크는 화면에 보이는 엑셀 서식의 안내 문구/유효성 검사만 바꾼다. 앞선 태스크들의 동작에는 영향 없음).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payment-request-xlsx.test.ts`의 139-155번째 줄 "지급명의/청구방식 컬럼에 드롭다운(목록 유효성 검사)이 적용된다"를 다음으로 교체:

```ts
  it("지급명의/청구방식 컬럼에 드롭다운(목록 유효성 검사)이 적용된다", async () => {
    const buf = await buildPaymentRequestRegistrationTemplateXlsxBuffer();
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    const entityCol = REGISTRATION_TEMPLATE_HEADERS.indexOf("지급명의") + 1;
    const taxTypeCol = REGISTRATION_TEMPLATE_HEADERS.indexOf("청구방식") + 1;
    const entityCell = ws.getCell(2, entityCol);
    const taxTypeCell = ws.getCell(2, taxTypeCol);
    expect(entityCell.dataValidation?.type).toBe("list");
    expect(taxTypeCell.dataValidation?.type).toBe("list");
    // 지급명의는 항상 필수(allowBlank: false) — exceljs는 이 값을 serialize하지 않으므로 읽을 때
    // undefined로 돌아온다. 청구방식은 매칭되면 생략 가능해져(allowBlank: true) 그대로 읽힌다.
    expect(entityCell.dataValidation?.allowBlank).not.toBe(true);
    expect(taxTypeCell.dataValidation?.allowBlank).toBe(true);
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/payment-request-xlsx.test.ts`
Expected: FAIL — 현재 청구방식 드롭다운은 `allowBlank: false`라 `taxTypeCell.dataValidation?.allowBlank`가 `undefined`로 나와 `.toBe(true)`에 실패.

- [ ] **Step 3: 구현 수정**

`src/app/(app)/expenses/payment-request/xlsx.ts`의 `REGISTRATION_HEADER_NOTES`(127-135번째 줄)를 다음으로 교체:

```ts
const REGISTRATION_HEADER_NOTES: Partial<Record<(typeof REGISTRATION_TEMPLATE_HEADERS)[number], string>> = {
  "지급명의": "필수",
  "고객사명": "필수",
  "사업자명(이름)": "필수 — 계좌번호와 함께 지급 리스트와 일치하면 자동 연동됩니다.",
  "은행명": "선택 — 지급 리스트와 자동 연동되면 생략 가능(단, 값을 입력했는데 지급 리스트와 다르면 오류). 지급 리스트에 없으면 필수.",
  "계좌번호": "필수 — 사업자명과 함께 지급 리스트와 일치하면 자동 연동됩니다.",
  "예금주": "선택 — 지급 리스트와 자동 연동되면 생략 가능(단, 값을 입력했는데 지급 리스트와 다르면 오류). 지급 리스트에 없으면 필수.",
  "단가": "필수",
  "횟수": "필수",
  "청구방식": "선택 — 지급 리스트와 자동 연동되면 생략 가능(단, 값을 입력했는데 지급 리스트와 다르면 오류). 지급 리스트에 없으면 필수.",
};
```

청구방식 드롭다운 유효성 검사(184-187번째 줄)를 다음으로 교체:

```ts
  const taxTypeCol = colLetter(REGISTRATION_TEMPLATE_HEADERS.indexOf("청구방식") + 1);
  dataValidations.add(`${taxTypeCol}2:${taxTypeCol}${REGISTRATION_TEMPLATE_DATA_ROWS + 1}`, {
    type: "list", allowBlank: true, formulae: [`"${TAX_TYPE_LABELS.join(",")}"`],
  });
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/payment-request-xlsx.test.ts`
Expected: PASS(전체).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/expenses/payment-request/xlsx.ts" test/payment-request-xlsx.test.ts
git commit -m "feat(payment-request): 등록 양식 안내 문구/드롭다운을 조건부 필수 규칙에 맞게 갱신"
```

---

## 최종 확인

- [ ] `npx vitest run` 전체 통과
- [ ] `npx tsc --noEmit` 에러 없음
- [ ] `npx prisma migrate status` → "Database schema is up to date!"
- [ ] 브라우저 검증은 이 계획의 범위에 포함하지 않는다 — 필요 시 컨트롤러가 로컬 dev DB(`.env.local`)에
      `20260805040000_add_payment_request_snapshot_fields` 마이그레이션을 별도로 적용해야
      실제 개발 서버에서 확인 가능하다(테스트 DB는 `test/global-setup.ts`가 자동 적용).
