# PM 지급요청 엑셀 대량 등록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM 등록 화면(`/expenses/payment-request/new`)에서 엑셀 파일을 업로드해 지급요청을 대량 등록할 수 있게 한다.

**Architecture:** 정산담당자 다운로드 20컬럼에서 5개(No/신청인/지급일/지급여부/총지급액)를 제외한 15컬럼짜리 업로드 양식을 만든다. 파싱(순수 함수, DB 없음) → 고객사/사업자 매칭(DB 읽기, `withRLS`) → 저장(all-or-nothing)의 3단계로 나누고, 팝업 모달에서 서식 다운로드와 업로드를 함께 제공한다.

**Tech Stack:** Next.js Server Actions, Prisma, `exceljs`, `zod`, `vitest`(실제 테스트 DB 연동).

**설계 문서:** `docs/superpowers/specs/2026-08-04-payment-request-pm-excel-bulk-create-design.md`

## Global Constraints

- 업로드는 `.xlsx`만 지원한다(CSV/XLS 없음).
- 저장은 all-or-nothing이다 — 한 행이라도 오류면 전체 미저장.
- `PaymentRequest`/`Payee` Prisma 스키마는 변경하지 않는다(마이그레이션 없음).
- 기존 수동 등록 경로(`createPaymentRequestsBulk`, `PaymentRequestRowsTable`, `paymentRequestRowSchema`)는 건드리지 않는다 — 이번 기능은 전부 새 함수/파일로 추가한다.
- 연락처/은행명/계좌번호/예금주는 어떤 경우에도 DB에 저장하지 않는다(참고용 컬럼).
- 연동 행(고유번호/사업자번호로 매칭됨)은 `사업자명`/`청구방식`을 무조건 `Payee` 마스터 값으로 확정하고 엑셀 값은 무시한다.
- 매칭키(고유번호/사업자번호)가 입력됐는데 매칭 대상을 못 찾으면 그 행은 오류(조용히 예외 행으로 넘기지 않는다).
- 이 저장소는 React 컴포넌트 자동 테스트가 없다(`vitest.config.ts`가 `environment: "node"`) — 컴포넌트/서버 액션/라우트 핸들러는 수동 검증만 한다. 순수 함수와 데이터 계층 함수만 자동 테스트 대상이다.

---

### Task 1: 업로드 행 검증 zod 스키마

**Files:**
- Modify: `src/lib/validation/schemas.ts`
- Test: `test/schemas.test.ts`

**Interfaces:**
- Consumes: `PAYMENT_REQUEST_ENTITY_LABELS`, `TAX_TYPE_LABELS`(이미 `src/lib/labels.ts`에 존재, `schemas.ts` 상단에서 이미 `TAX_TYPE_LABELS`를 import 중인지 확인 후 없으면 추가).
- Produces: `paymentRequestUploadRowSchema` — Task 2가 이 스키마로 엑셀 한 행(전부 문자열 필드)을 검증한다. 파싱 결과 타입: `{ entity: "휴노"|"휴노INC"; clientName: string; bizNameRaw: string; keyId: string; bizNumberDigits: string; unitPrice: number; transportFee: number; materialFee: number; count: number; taxTypeRaw: string; memo: string }` (keyId/bizNumberDigits는 빈 문자열 허용 — Task 2가 빈 문자열을 `null`로 정규화한다).

**Context:** `schemas.ts` 108~132행에 이미 `bizNumberDigits`(필수 10/13자리) 헬퍼와 `payeeUploadRowSchema` 패턴이 있다. 이번 스키마는 그 패턴을 재사용하되, 사업자번호를 **선택**(0/10/13자리 허용)으로 만들고, "고유번호도 사업자번호도 없으면 사업자명·청구방식 필수"라는 조건부 규칙을 `superRefine`으로 추가한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/schemas.test.ts` 파일을 열어 기존 `describe` 블록들의 스타일을 확인한 뒤, 파일 끝에 다음을 추가한다:

```ts
describe("paymentRequestUploadRowSchema", () => {
  function row(overrides: Partial<{
    entity: string; clientName: string; bizNameRaw: string; keyId: string;
    bizNumberDigits: string; unitPrice: string; transportFee: string;
    materialFee: string; count: string; taxTypeRaw: string; memo: string;
  }> = {}) {
    return {
      entity: "휴노", clientName: "A사", bizNameRaw: "", keyId: "a001",
      bizNumberDigits: "", unitPrice: "10000", transportFee: "0",
      materialFee: "0", count: "1", taxTypeRaw: "", memo: "",
      ...overrides,
    };
  }

  it("고유번호가 있으면 사업자명/청구방식이 빈 문자열이어도 통과한다", () => {
    expect(paymentRequestUploadRowSchema.safeParse(row()).success).toBe(true);
  });

  it("사업자번호가 있으면(고유번호 없이) 사업자명/청구방식이 빈 문자열이어도 통과한다", () => {
    const result = paymentRequestUploadRowSchema.safeParse(
      row({ keyId: "", bizNumberDigits: "1234567890" }),
    );
    expect(result.success).toBe(true);
  });

  it("고유번호·사업자번호가 둘 다 없으면 사업자명이 필수다", () => {
    const result = paymentRequestUploadRowSchema.safeParse(
      row({ keyId: "", bizNumberDigits: "", bizNameRaw: "", taxTypeRaw: "세금계산서" }),
    );
    expect(result.success).toBe(false);
  });

  it("고유번호·사업자번호가 둘 다 없으면 청구방식이 필수다", () => {
    const result = paymentRequestUploadRowSchema.safeParse(
      row({ keyId: "", bizNumberDigits: "", bizNameRaw: "홍길동", taxTypeRaw: "" }),
    );
    expect(result.success).toBe(false);
  });

  it("고유번호·사업자번호가 둘 다 없어도 사업자명+유효한 청구방식이 있으면 통과한다", () => {
    const result = paymentRequestUploadRowSchema.safeParse(
      row({ keyId: "", bizNumberDigits: "", bizNameRaw: "홍길동", taxTypeRaw: "세금계산서" }),
    );
    expect(result.success).toBe(true);
  });

  it("사업자번호 형식이 9자리면 오류", () => {
    const result = paymentRequestUploadRowSchema.safeParse(
      row({ keyId: "", bizNumberDigits: "123456789" }),
    );
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

이 시점에서는 `paymentRequestUploadRowSchema`가 아직 없으므로 import 에러로 실패한다. 파일 상단 import 목록에 `paymentRequestUploadRowSchema`를 추가해 둔다(다른 스키마들과 같은 import 문에 이어 쓴다).

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: FAIL — `paymentRequestUploadRowSchema`가 정의되지 않았다는 타입/런타임 오류.

- [ ] **Step 3: 스키마 구현**

`src/lib/validation/schemas.ts`의 `paymentRequestRowSchema`(151~160행) 바로 다음에 추가한다. 파일 상단에 이미 있는 `PAYMENT_REQUEST_ENTITY_LABELS`/`TAX_TYPE_LABELS` import를 확인하고 없으면 `@/lib/labels`에서 추가로 가져온다.

```ts
// 사업자번호(선택) — 값이 있으면 10/13자리(하이픈 허용), 없으면(빈 문자열) 통과.
// 필수 버전(bizNumberDigits, 107~112행)과 자릿수 검증 로직은 같고 "0자리 허용"만 다르다.
const optionalBizNumberDigits = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/\D/g, "") : v),
  z.string().refine((s) => s.length === 0 || s.length === 10 || s.length === 13,
    "사업자번호는 10자리(사업자) 또는 13자리(주민등록번호)여야 합니다."),
);

// PM 엑셀 대량 등록 한 행. 고유번호/사업자번호 중 하나라도 있으면 지급 리스트와 연동되는
// "연동 행"으로 보고 사업자명/청구방식을 검사하지 않는다(매칭된 Payee 값으로 서버가 덮어씀).
// 둘 다 없으면 "예외 행"으로 보고 사업자명/청구방식이 직접 저장되므로 필수로 검사한다.
export const paymentRequestUploadRowSchema = z.object({
  entity: z.enum(PAYMENT_REQUEST_ENTITY_LABELS),
  clientName: z.string().trim().min(1, "고객사명을 입력하세요."),
  bizNameRaw: z.string().trim(),
  keyId: z.string().trim(),
  bizNumberDigits: optionalBizNumberDigits,
  unitPrice: z.coerce.number().int().min(1),
  transportFee: z.coerce.number().int().min(0),
  materialFee: z.coerce.number().int().min(0),
  count: z.coerce.number().int().min(1),
  taxTypeRaw: z.string().trim(),
  memo: z.string(),
}).superRefine((v, ctx) => {
  const hasMatchKey = v.keyId.length > 0 || v.bizNumberDigits.length > 0;
  if (hasMatchKey) return;
  if (v.bizNameRaw.length === 0) {
    ctx.addIssue({ code: "custom", path: ["bizNameRaw"], message: "사업자명을 입력하세요(지급 리스트에 없는 경우 필수)." });
  }
  if (!(TAX_TYPE_LABELS as readonly string[]).includes(v.taxTypeRaw)) {
    ctx.addIssue({ code: "custom", path: ["taxTypeRaw"], message: "청구방식을 선택하세요(지급 리스트에 없는 경우 필수)." });
  }
});
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: PASS (전체 테스트, 기존 테스트 포함)

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/validation/schemas.ts test/schemas.test.ts
git commit -m "feat(payment-request): PM 엑셀 등록 행 검증 스키마 추가"
```

---

### Task 2: 엑셀 → 등록 행 순수 파싱 함수

**Files:**
- Create: `src/lib/data/payment-request-registration-upload.ts`
- Test: `test/payment-request-registration-upload.test.ts`

**Interfaces:**
- Consumes: `paymentRequestUploadRowSchema`(Task 1), `PAYMENT_REQUEST_ENTITY_BY_LABEL`(`@/lib/labels`, 기존).
- Produces:
  - `REGISTRATION_TEMPLATE_HEADERS: readonly string[]` (15개, 순서 고정) — Task 4(템플릿 생성)와 Task 6(서버 액션은 직접 안 씀, 이 파일 내부에서만 헤더 매칭에 사용)가 이 상수를 재사용한다.
  - `type ParsedRegistrationRow = { entity: "HUNO"|"HUNO_INC"; clientName: string; bizNameRaw: string; keyId: string | null; bizNumberDigits: string | null; taxTypeRaw: string | null; unitPrice: number; transportFee: number; materialFee: number; count: number; memo: string }` — Task 3(`createPaymentRequestsFromUpload`)이 이 타입을 그대로 소비한다.
  - `function buildPaymentRequestRegistrationRowsFromXlsx(rows: string[][]): { rows: { row: number; data: ParsedRegistrationRow }[]; errors: { row: number; message: string }[] }` — Task 6(서버 액션)이 `parseXlsxToRows`의 결과를 이 함수에 넘긴다.

**Context:** `src/app/(app)/expenses/payees/build-inputs.ts`(헤더 매핑 + 빈 행 skip + zod 검증 패턴)과 `src/lib/data/payment-request-upload.ts`(`row` 번호를 1-based 엑셀 행 번호로 보존하는 방식)를 그대로 본뜬다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payment-request-registration-upload.test.ts` 신규 생성:

```ts
import { describe, it, expect } from "vitest";
import { buildPaymentRequestRegistrationRowsFromXlsx, REGISTRATION_TEMPLATE_HEADERS } from "@/lib/data/payment-request-registration-upload";

const HEADER = [...REGISTRATION_TEMPLATE_HEADERS];

function fullRow(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    "지급명의": "휴노", "고객사명": "A사", "사업자명(이름)": "", "고유번호": "a001",
    "연락처": "", "사업자번호(주민등록번호)": "", "은행명": "", "계좌번호": "", "예금주": "",
    "단가": "10000", "교통비": "0", "재료비": "0", "횟수": "1", "청구방식": "", "상세내역": "메모",
    ...overrides,
  };
  return REGISTRATION_TEMPLATE_HEADERS.map((h) => base[h]);
}

describe("buildPaymentRequestRegistrationRowsFromXlsx", () => {
  it("고유번호가 있는 연동 행을 파싱한다 — 사업자명/청구방식은 null로 무시 표시", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow()]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{
      row: 2,
      data: {
        entity: "HUNO", clientName: "A사", bizNameRaw: "", keyId: "a001", bizNumberDigits: null,
        taxTypeRaw: null, unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "메모",
      },
    }]);
  });

  it("사업자번호만 있는 연동 행도 파싱한다(고유번호 공란)", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자번호(주민등록번호)": "1234567890" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].data.keyId).toBeNull();
    expect(result.rows[0].data.bizNumberDigits).toBe("1234567890");
    expect(result.rows[0].data.taxTypeRaw).toBeNull();
  });

  it("고유번호·사업자번호가 둘 다 없는 예외 행은 사업자명/청구방식을 그대로 보존한다", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자명(이름)": "홍길동", "청구방식": "세금계산서" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].data.keyId).toBeNull();
    expect(result.rows[0].data.bizNumberDigits).toBeNull();
    expect(result.rows[0].data.bizNameRaw).toBe("홍길동");
    expect(result.rows[0].data.taxTypeRaw).toBe("세금계산서");
  });

  it("예외 행인데 사업자명이 없으면 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자명(이름)": "", "청구방식": "세금계산서" }),
    ]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
  });

  it("예외 행인데 청구방식이 없으면 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자명(이름)": "홍길동", "청구방식": "" }),
    ]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("지급명의 값이 잘못되면 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "지급명의": "다른회사" })]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("사업자번호 형식이 잘못되면(9자리) 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER, fullRow({ "고유번호": "", "사업자번호(주민등록번호)": "123456789" }),
    ]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("단가/횟수가 0 이하면 오류", () => {
    expect(buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "단가": "0" })]).errors).toHaveLength(1);
    expect(buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "횟수": "0" })]).errors).toHaveLength(1);
  });

  it("교통비/재료비가 공란이면 0으로 처리된다", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, fullRow({ "교통비": "", "재료비": "" })]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].data.transportFee).toBe(0);
    expect(result.rows[0].data.materialFee).toBe(0);
  });

  it("완전히 빈 행은 건너뛴다", () => {
    const blank = REGISTRATION_TEMPLATE_HEADERS.map(() => "");
    const result = buildPaymentRequestRegistrationRowsFromXlsx([HEADER, blank, fullRow()]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].row).toBe(3);
  });

  it("헤더 누락 시 전체 오류", () => {
    const badHeader = HEADER.filter((h) => h !== "고유번호");
    const result = buildPaymentRequestRegistrationRowsFromXlsx([badHeader]);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 0, message: "헤더 누락: 고유번호" }]);
  });

  it("빈 파일이면 오류", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([]);
    expect(result.errors).toEqual([{ row: 0, message: "빈 파일입니다." }]);
  });

  it("여러 행 중 일부만 오류여도 나머지는 정상 파싱된다", () => {
    const result = buildPaymentRequestRegistrationRowsFromXlsx([
      HEADER,
      fullRow(),
      fullRow({ "지급명의": "다른회사" }),
      fullRow({ "고유번호": "b002" }),
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.row)).toEqual([2, 4]);
    expect(result.errors).toEqual([{ row: 3, message: expect.any(String) }]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run test/payment-request-registration-upload.test.ts`
Expected: FAIL — 모듈이 존재하지 않음.

- [ ] **Step 3: 구현**

`src/lib/data/payment-request-registration-upload.ts` 신규 생성:

```ts
import { paymentRequestUploadRowSchema } from "@/lib/validation/schemas";
import { PAYMENT_REQUEST_ENTITY_BY_LABEL } from "@/lib/labels";
import type { PaymentRequestEntity } from "@prisma/client";

// 서식·업로드 공통 컬럼 순서. 정산담당자 다운로드 20컬럼에서 No/신청인/지급일/지급여부/
// 총지급액(자동·연동·서버계산 값)을 제외한 15개.
export const REGISTRATION_TEMPLATE_HEADERS = [
  "지급명의", "고객사명", "사업자명(이름)", "고유번호", "연락처",
  "사업자번호(주민등록번호)", "은행명", "계좌번호", "예금주",
  "단가", "교통비", "재료비", "횟수", "청구방식", "상세내역",
] as const;

export type ParsedRegistrationRow = {
  entity: PaymentRequestEntity;
  clientName: string;
  bizNameRaw: string;
  keyId: string | null;
  bizNumberDigits: string | null;
  // 연동 행(keyId/bizNumberDigits 중 하나라도 있음)이면 null(매칭된 Payee 값을 쓸 것이므로 무시).
  // 예외 행(둘 다 없음)이면 스키마가 이미 검증한 유효 라벨 문자열.
  taxTypeRaw: string | null;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  memo: string;
};

export type BuildRegistrationRowsResult = {
  rows: { row: number; data: ParsedRegistrationRow }[];
  errors: { row: number; message: string }[];
};

// 첫 행을 헤더로 보고 15개 컬럼을 이름으로 매핑한 뒤 행별로 검증한다. DB 접근 없음(순수 함수) —
// 고객사/사업자 매칭은 다음 단계(createPaymentRequestsFromUpload)의 책임이다.
export function buildPaymentRequestRegistrationRowsFromXlsx(rows: string[][]): BuildRegistrationRowsResult {
  const result: BuildRegistrationRowsResult = { rows: [], errors: [] };

  if (rows.length === 0) {
    result.errors.push({ row: 0, message: "빈 파일입니다." });
    return result;
  }

  const header = rows[0].map((h) => h.trim());
  const colIndex: Record<string, number> = {};
  const missing: string[] = [];
  for (const field of REGISTRATION_TEMPLATE_HEADERS) {
    const idx = header.indexOf(field);
    if (idx === -1) missing.push(field);
    else colIndex[field] = idx;
  }
  if (missing.length > 0) {
    result.errors.push({ row: 0, message: `헤더 누락: ${missing.join(", ")}` });
    return result;
  }
  const at = (cells: string[], field: (typeof REGISTRATION_TEMPLATE_HEADERS)[number]) =>
    (cells[colIndex[field]] ?? "").trim();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => (c ?? "").trim() === "")) continue;

    const parsed = paymentRequestUploadRowSchema.safeParse({
      entity: at(cells, "지급명의"),
      clientName: at(cells, "고객사명"),
      bizNameRaw: at(cells, "사업자명(이름)"),
      keyId: at(cells, "고유번호"),
      bizNumberDigits: at(cells, "사업자번호(주민등록번호)"),
      unitPrice: at(cells, "단가"),
      transportFee: at(cells, "교통비"),
      materialFee: at(cells, "재료비"),
      count: at(cells, "횟수"),
      taxTypeRaw: at(cells, "청구방식"),
      memo: at(cells, "상세내역"),
    });
    if (!parsed.success) {
      result.errors.push({ row: r + 1, message: parsed.error.issues[0]?.message ?? "형식 오류" });
      continue;
    }

    const d = parsed.data;
    const hasMatchKey = d.keyId.length > 0 || d.bizNumberDigits.length > 0;
    result.rows.push({
      row: r + 1,
      data: {
        entity: PAYMENT_REQUEST_ENTITY_BY_LABEL[d.entity],
        clientName: d.clientName,
        bizNameRaw: d.bizNameRaw,
        keyId: d.keyId.length > 0 ? d.keyId : null,
        bizNumberDigits: d.bizNumberDigits.length > 0 ? d.bizNumberDigits : null,
        taxTypeRaw: hasMatchKey ? null : d.taxTypeRaw,
        unitPrice: d.unitPrice,
        transportFee: d.transportFee,
        materialFee: d.materialFee,
        count: d.count,
        memo: d.memo,
      },
    });
  }
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/payment-request-registration-upload.test.ts`
Expected: PASS

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/data/payment-request-registration-upload.ts test/payment-request-registration-upload.test.ts
git commit -m "feat(payment-request): PM 엑셀 등록 행 순수 파싱 함수 추가"
```

---

### Task 3: 고객사/사업자 매칭 + 저장 데이터 계층 함수

**Files:**
- Modify: `src/lib/data/payment-requests.ts`
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: `ParsedRegistrationRow`(Task 2, `@/lib/data/payment-request-registration-upload`에서 import), `blindIndex`(`@/lib/crypto/payee-secret`, 기존), `TAX_TYPE_BY_LABEL`(`@/lib/labels`, 기존).
- Produces: `function createPaymentRequestsFromUpload(ctx: RlsContext, requesterId: string, rows: { row: number; data: ParsedRegistrationRow }[]): Promise<{ ok: true; created: number } | { ok: false; errors: { row: number; message: string }[] }>` — Task 6(서버 액션)이 이 함수를 호출한다.

**Context:** 이 파일 296~363행의 `createPaymentRequestsBulk`처럼 `withRLS` 트랜잭션을 쓰지만, 이 함수는 이름/키 문자열로 먼저 DB를 조회(읽기)해 오류를 모으고, 오류가 하나도 없을 때만 insert한다. 읽기만 하고 오류를 반환하면 아직 아무것도 쓰지 않았으므로 별도 롤백 처리가 필요 없다(트랜잭션이 빈 상태로 커밋될 뿐).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-requests.test.ts` 파일 끝(마지막 `describe("softDeletePaymentRequests", ...)` 블록 다음, 최상위 `describe("payment-requests 데이터 계층", ...)`가 닫히기 전)에 추가한다. 기존 파일 상단 import에 `createPaymentRequestsFromUpload`를 추가하고, `ParsedRegistrationRow`를 만들기 위한 헬퍼도 함께 추가한다:

```ts
// 기존 import 블록에 추가
import { createPaymentRequestsFromUpload } from "@/lib/data/payment-requests";
import type { ParsedRegistrationRow } from "@/lib/data/payment-request-registration-upload";
```

```ts
  describe("createPaymentRequestsFromUpload", () => {
    function uploadRow(row: number, overrides: Partial<ParsedRegistrationRow> = {}) {
      return {
        row,
        data: {
          entity: "HUNO" as const,
          clientName: "A사",
          bizNameRaw: "",
          keyId: null,
          bizNumberDigits: null,
          taxTypeRaw: null,
          unitPrice: 10000,
          transportFee: 0,
          materialFee: 0,
          count: 1,
          memo: "",
          ...overrides,
        },
      };
    }

    it("고유번호로 매칭되면 payeeId 연동 + bizName/taxType은 Payee 스냅샷을 저장한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1111111111", "업체A", "TAX_INVOICE");

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: clientA.name, keyId: payee.keyId }),
      ]);
      expect(result).toEqual({ ok: true, created: 1 });

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.payeeId).toBe(payee.id);
      expect(row.bizName).toBe("업체A");
      expect(row.taxType).toBe("TAX_INVOICE");
    });

    it("사업자번호로도 매칭한다(고유번호 없을 때)", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1101234567", "김강사", "BUSINESS_INCOME");

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: clientA.name, keyId: null, bizNumberDigits: "1101234567" }),
      ]);
      expect(result).toEqual({ ok: true, created: 1 });

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.payeeId).toBe(payee.id);
      expect(row.bizName).toBe("김강사");
      expect(row.taxType).toBe("BUSINESS_INCOME");
    });

    it("고유번호가 있는데 매칭되지 않으면 오류를 반환하고 미저장한다", async () => {
      const { pmA, clientA } = await seed();
      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: clientA.name, keyId: "존재하지않는키" }),
      ]);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("사업자번호가 있는데 매칭되지 않으면 오류를 반환하고 미저장한다", async () => {
      const { pmA, clientA } = await seed();
      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: clientA.name, keyId: null, bizNumberDigits: "9999999999" }),
      ]);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("고유번호·사업자번호가 둘 다 없으면 예외 행으로 저장한다(payeeId null, 입력값 그대로)", async () => {
      const { pmA, clientA } = await seed();
      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: clientA.name, bizNameRaw: "홍길동", taxTypeRaw: "세금계산서" }),
      ]);
      expect(result).toEqual({ ok: true, created: 1 });

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.payeeId).toBeNull();
      expect(row.bizName).toBe("홍길동");
      expect(row.taxType).toBe("TAX_INVOICE");
    });

    it("등록되지 않은 고객사명이면 오류를 반환하고 미저장한다", async () => {
      const { pmA } = await seed();
      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: "존재하지않는고객사", bizNameRaw: "홍길동", taxTypeRaw: "세금계산서" }),
      ]);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("동일한 이름의 고객사가 여러 건이면 오류를 반환한다", async () => {
      const { pmA, clientA } = await seed();
      // Client SELECT RLS는 PM에게 담당 고객사만 보여준다(clientmanager_rls) — 중복 매칭을
      // 재현하려면 두 번째 동명 고객사도 pmA가 담당하도록 만들어야 findMany가 둘 다 반환한다.
      await withRLS(ADMIN, (tx) => tx.client.create({
        data: { name: clientA.name, businessType: "휴노", managers: { create: [{ userId: pmA.id }] } },
      }));

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: clientA.name, bizNameRaw: "홍길동", taxTypeRaw: "세금계산서" }),
      ]);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("여러 행 중 하나라도 오류면 전체를 저장하지 않는다(all-or-nothing)", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1111111111", "업체A");

      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, { clientName: clientA.name, keyId: payee.keyId }),
        uploadRow(3, { clientName: clientA.name, keyId: "존재하지않는키" }),
      ]);
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("지급액을 서버가 재계산한다", async () => {
      const { pmA, clientA } = await seed();
      const result = await createPaymentRequestsFromUpload({ userId: pmA.id, role: "PM" }, pmA.id, [
        uploadRow(2, {
          clientName: clientA.name, bizNameRaw: "홍길동", taxTypeRaw: "세금계산서",
          unitPrice: 100000, transportFee: 5000, materialFee: 2000, count: 3,
        }),
      ]);
      expect(result).toEqual({ ok: true, created: 1 });

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.amount).toBe((100000 + 5000 + 2000) * 3);
    });
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run test/data-payment-requests.test.ts -t createPaymentRequestsFromUpload`
Expected: FAIL — `createPaymentRequestsFromUpload`가 export되지 않음.

- [ ] **Step 3: 구현**

`src/lib/data/payment-requests.ts` 상단 import에 추가:

```ts
import { blindIndex } from "@/lib/crypto/payee-secret"; // 기존 decrypt import 옆에 추가
import { TAX_TYPE_BY_LABEL } from "@/lib/labels";
import type { ParsedRegistrationRow } from "./payment-request-registration-upload";
```

파일 끝(`softDeletePaymentRequests` 함수 뒤)에 추가:

```ts
export type PaymentRequestUploadCreateResult =
  | { ok: true; created: number }
  | { ok: false; errors: { row: number; message: string }[] };

// PM 엑셀 대량 등록 전용. 각 행의 고객사명/고유번호/사업자번호를 조회해 매칭한다. 매칭 오류가
// 하나라도 있으면 아직 insert 전이므로 그대로 반환한다(all-or-nothing — 이미 쓴 것을 롤백할
// 필요가 없다, softDeletePaymentRequests의 PartialDeleteError 패턴과 달리 여기선 "쓰기 전에
// 미리 전부 확인"하는 방식이라 트랜잭션 예외를 던질 필요가 없다).
export async function createPaymentRequestsFromUpload(
  ctx: RlsContext,
  requesterId: string,
  rows: { row: number; data: ParsedRegistrationRow }[],
): Promise<PaymentRequestUploadCreateResult> {
  return withRLS(ctx, async (tx) => {
    const errors: { row: number; message: string }[] = [];
    const resolved: {
      entity: PaymentRequestEntity; clientId: string; payeeId: string | null;
      bizName: string; taxType: TaxType; unitPrice: number; transportFee: number;
      materialFee: number; count: number; memo: string;
    }[] = [];

    for (const { row, data } of rows) {
      const clients = await tx.client.findMany({
        where: { name: data.clientName, deletedAt: null },
        select: { id: true },
      });
      if (clients.length === 0) {
        errors.push({ row, message: `등록되지 않은 고객사명입니다: ${data.clientName}` });
        continue;
      }
      if (clients.length > 1) {
        errors.push({ row, message: `동일한 이름의 고객사가 여러 건 있어 자동 선택할 수 없습니다: ${data.clientName}` });
        continue;
      }

      let payee: { id: string; bizName: string; taxType: TaxType } | null = null;
      if (data.keyId) {
        payee = await tx.payee.findFirst({
          where: { keyId: data.keyId, deletedAt: null },
          select: { id: true, bizName: true, taxType: true },
        });
        if (!payee) {
          errors.push({ row, message: `고유번호에 해당하는 지급 대상을 찾을 수 없습니다: ${data.keyId}` });
          continue;
        }
      } else if (data.bizNumberDigits) {
        payee = await tx.payee.findFirst({
          where: { bizNumberBidx: blindIndex(data.bizNumberDigits), deletedAt: null },
          select: { id: true, bizName: true, taxType: true },
        });
        if (!payee) {
          errors.push({ row, message: "사업자번호에 해당하는 지급 대상을 찾을 수 없습니다." });
          continue;
        }
      }

      // payee가 null이면 파서(Task 2)가 이미 taxTypeRaw를 유효한 라벨로 검증해뒀다(예외 행).
      const taxType = payee ? payee.taxType : TAX_TYPE_BY_LABEL[data.taxTypeRaw as keyof typeof TAX_TYPE_BY_LABEL];
      resolved.push({
        entity: data.entity,
        clientId: clients[0].id,
        payeeId: payee?.id ?? null,
        bizName: payee?.bizName ?? data.bizNameRaw,
        taxType,
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
        },
      });
    }
    return { ok: true, created: resolved.length };
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: PASS (전체 — 기존 테스트도 함께 재실행되므로 회귀 없는지 확인)

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat(payment-request): PM 엑셀 등록 매칭+저장 데이터 계층 함수 추가"
```

---

### Task 4: 업로드 양식(빈 템플릿) 엑셀 생성

**Files:**
- Modify: `src/app/(app)/expenses/payment-request/xlsx.ts`
- Test: `test/payment-request-xlsx.test.ts`

**Interfaces:**
- Consumes: `REGISTRATION_TEMPLATE_HEADERS`(Task 2, `@/lib/data/payment-request-registration-upload`), `PAYMENT_REQUEST_ENTITY_LABELS`/`TAX_TYPE_LABELS`(`@/lib/labels`, 기존).
- Produces: `function buildPaymentRequestRegistrationTemplateXlsxBuffer(): Promise<Buffer>` — Task 5(다운로드 라우트)가 호출한다.

**Context:** 이 파일에 이미 있는 `displayWidth`/`colLetter`/`buildPaymentRequestExportXlsxBuffer`와, `src/app/(app)/expenses/payees/xlsx.ts`의 `buildTemplateXlsxBuffer`(드롭다운·시트보호·헤더메모 패턴)를 함께 참고한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payment-request-xlsx.test.ts` 파일 끝(기존 `describe` 블록의 마지막 `it` 다음, 파일이 `describe`를 어떻게 닫는지 확인 후)에 추가한다. 파일 상단 import에 추가:

```ts
import {
  buildPaymentRequestRegistrationTemplateXlsxBuffer,
} from "@/app/(app)/expenses/payment-request/xlsx";
import { REGISTRATION_TEMPLATE_HEADERS } from "@/lib/data/payment-request-registration-upload";
```

```ts
describe("payment-request registration template xlsx", () => {
  it("헤더 15개가 지정된 순서로 생성된다", async () => {
    const buf = await buildPaymentRequestRegistrationTemplateXlsxBuffer();
    const rows = await parseXlsxToRows(buf);
    expect(rows[0]).toEqual([...REGISTRATION_TEMPLATE_HEADERS]);
  });

  it("사업자번호·계좌번호 컬럼은 텍스트 서식이다", async () => {
    const buf = await buildPaymentRequestRegistrationTemplateXlsxBuffer();
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    expect(ws.getColumn(REGISTRATION_TEMPLATE_HEADERS.indexOf("사업자번호(주민등록번호)") + 1).numFmt).toBe("@");
    expect(ws.getColumn(REGISTRATION_TEMPLATE_HEADERS.indexOf("계좌번호") + 1).numFmt).toBe("@");
  });

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
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run test/payment-request-xlsx.test.ts`
Expected: FAIL — `buildPaymentRequestRegistrationTemplateXlsxBuffer`가 export되지 않음.

- [ ] **Step 3: 구현**

`src/app/(app)/expenses/payment-request/xlsx.ts` 상단 import 수정(기존 `@/lib/labels` import 줄에 `PAYMENT_REQUEST_ENTITY_LABELS`, `TAX_TYPE_LABELS` 추가) + 새 import 추가:

```ts
import { paymentRequestEntityLabel, taxTypeLabel, paymentRequestStatusLabel, PAYMENT_REQUEST_STATUS_LABELS, PAYMENT_REQUEST_ENTITY_LABELS, TAX_TYPE_LABELS } from "@/lib/labels";
import { REGISTRATION_TEMPLATE_HEADERS } from "@/lib/data/payment-request-registration-upload";
```

파일 끝(`buildPaymentRequestExportXlsxBuffer` 뒤)에 추가:

```ts
const REGISTRATION_TEMPLATE_DATA_ROWS = 1000;

const REGISTRATION_HEADER_NOTES: Partial<Record<(typeof REGISTRATION_TEMPLATE_HEADERS)[number], string>> = {
  "사업자명(이름)": "지급 리스트에 이미 등록된 대상(고유번호 또는 사업자번호 입력)은 비워도 됩니다.",
  "연락처": "참고용 — 저장되지 않습니다.",
  "은행명": "참고용 — 저장되지 않습니다.",
  "계좌번호": "참고용 — 저장되지 않습니다.",
  "예금주": "참고용 — 저장되지 않습니다.",
  "청구방식": "지급 리스트에 이미 등록된 대상(고유번호 또는 사업자번호 입력)은 비워도 됩니다.",
};

// PM 엑셀 대량 등록용 빈 서식. payees/xlsx.ts의 buildTemplateXlsxBuffer와 같은 패턴
// (헤더 고정 + 드롭다운 + 시트 보호)을 이 파일 전용 컬럼(15개)으로 적용한다.
export async function buildPaymentRequestRegistrationTemplateXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("지급요청등록");
  ws.addRow([...REGISTRATION_TEMPLATE_HEADERS]);

  const TEXT_COLUMNS = ["사업자번호(주민등록번호)", "계좌번호"] as const;
  TEXT_COLUMNS.forEach((h) => { ws.getColumn(REGISTRATION_TEMPLATE_HEADERS.indexOf(h) + 1).numFmt = "@"; });

  const COLUMN_WIDTH_PADDING = 4;
  REGISTRATION_TEMPLATE_HEADERS.forEach((header, i) => {
    const candidates = header === "청구방식" ? [header, ...TAX_TYPE_LABELS]
      : header === "지급명의" ? [header, ...PAYMENT_REQUEST_ENTITY_LABELS]
      : [header];
    ws.getColumn(i + 1).width = Math.max(...candidates.map(displayWidth)) + COLUMN_WIDTH_PADDING;
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
  };
  for (let r = 1; r <= REGISTRATION_TEMPLATE_DATA_ROWS + 1; r++) {
    const isHeader = r === 1;
    for (let c = 1; c <= REGISTRATION_TEMPLATE_HEADERS.length; c++) {
      const cell = ws.getCell(r, c);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder;
      cell.protection = { locked: isHeader };
      if (isHeader) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
        const note = REGISTRATION_HEADER_NOTES[REGISTRATION_TEMPLATE_HEADERS[c - 1]];
        if (note) cell.note = note;
      }
    }
  }

  // exceljs 타입 정의에 Worksheet.dataValidations가 누락돼 있어 unknown 경유로 우회.
  const dataValidations = (ws as unknown as {
    dataValidations: { add: (address: string, dv: ExcelJS.DataValidation) => void };
  }).dataValidations;
  const entityCol = colLetter(REGISTRATION_TEMPLATE_HEADERS.indexOf("지급명의") + 1);
  dataValidations.add(`${entityCol}2:${entityCol}${REGISTRATION_TEMPLATE_DATA_ROWS + 1}`, {
    type: "list", allowBlank: false, formulae: [`"${PAYMENT_REQUEST_ENTITY_LABELS.join(",")}"`],
  });
  const taxTypeCol = colLetter(REGISTRATION_TEMPLATE_HEADERS.indexOf("청구방식") + 1);
  dataValidations.add(`${taxTypeCol}2:${taxTypeCol}${REGISTRATION_TEMPLATE_DATA_ROWS + 1}`, {
    type: "list", allowBlank: true, formulae: [`"${TAX_TYPE_LABELS.join(",")}"`],
  });

  await ws.protect("", {});
  return Buffer.from(await wb.xlsx.writeBuffer());
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/payment-request-xlsx.test.ts`
Expected: PASS

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add "src/app/(app)/expenses/payment-request/xlsx.ts" test/payment-request-xlsx.test.ts
git commit -m "feat(payment-request): PM 엑셀 등록 양식(빈 템플릿) 생성 함수 추가"
```

---

### Task 5: 업로드 양식 다운로드 라우트

**Files:**
- Create: `src/app/(app)/expenses/payment-request/registration-template/route.ts`

**Interfaces:**
- Consumes: `buildPaymentRequestRegistrationTemplateXlsxBuffer`(Task 4), `requireRole`(`@/lib/auth/session`, 기존).
- Produces: `GET /expenses/payment-request/registration-template` — Task 7(모달)의 "⬇ 엑셀 서식 다운로드" 링크가 이 경로를 가리킨다.

**Context:** `src/app/(app)/expenses/payees/template/route.ts`와 동일한 패턴(1:1로 본뜬다). 이 태스크는 순수 함수가 아니므로(Next.js 라우트 핸들러) 자동 테스트 없이 수동 검증한다.

- [ ] **Step 1: 구현**

`src/app/(app)/expenses/payment-request/registration-template/route.ts` 신규 생성:

```ts
import { requireRole } from "@/lib/auth/session";
import { buildPaymentRequestRegistrationTemplateXlsxBuffer } from "../xlsx";

export const runtime = "nodejs";

// PM 엑셀 대량 등록용 빈 서식(.xlsx) 다운로드. 헤더만 있고 PII가 없어 등록 권한(PM)과 동일하게 연다.
export async function GET() {
  await requireRole("PM"); // ADMIN/SETTLEMENT도 랭크상 통과.
  const buf = await buildPaymentRequestRegistrationTemplateXlsxBuffer();
  const filename = encodeURIComponent("지급요청_등록양식.xlsx");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 3: 수동 검증**

Run: `npm run dev` (이미 실행 중이 아니라면), 로그인 후 브라우저에서 `http://localhost:3000/expenses/payment-request/registration-template` 접속.
Expected: `지급요청_등록양식.xlsx` 파일이 다운로드되고, 열어보면 15개 헤더 + 지급명의/청구방식 드롭다운이 보인다.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/expenses/payment-request/registration-template/route.ts"
git commit -m "feat(payment-request): PM 엑셀 등록 양식 다운로드 라우트 추가"
```

---

### Task 6: 업로드 서버 액션

**Files:**
- Create: `src/app/(app)/expenses/payment-request/create-upload-state.ts`
- Modify: `src/app/(app)/expenses/payment-request/actions.ts`

**Interfaces:**
- Consumes: `buildPaymentRequestRegistrationRowsFromXlsx`(Task 2), `createPaymentRequestsFromUpload`(Task 3), `parseXlsxToRows`(기존, 이미 이 파일에서 import 중).
- Produces:
  - `type PaymentRequestCreateUploadState = ActionState & { created?: number; rowErrors?: { row: number; message: string }[] }`, `PAYMENT_REQUEST_CREATE_UPLOAD_INIT`.
  - `async function uploadPaymentRequestCreatesAction(_prev: PaymentRequestCreateUploadState, formData: FormData): Promise<PaymentRequestCreateUploadState>` — Task 7(모달)이 `useActionState`로 이 함수를 사용한다. `formData`는 `file`(File) 필드 하나만 읽는다.

**Context:** `uploadPaymentRequestUpdatesAction`(같은 파일, 18~71행)과 `uploadPayeesAction`(`payees/actions.ts`)의 에러 처리 패턴을 그대로 따른다. 자동 테스트는 없음(서버 액션은 이 저장소 관례상 테스트 대상이 아님) — 수동 검증으로 확인한다.

- [ ] **Step 1: 상태 타입 파일 작성**

`src/app/(app)/expenses/payment-request/create-upload-state.ts` 신규 생성:

```ts
import type { ActionState } from "@/lib/action-state";

// PM 엑셀 대량 등록 업로드 결과 상태(모달의 useActionState용). "use server" 파일(actions.ts)은
// 함수만 export할 수 있어 상수/타입은 여기 일반 모듈에 둔다.
export type PaymentRequestCreateUploadState = ActionState & {
  created?: number;
  rowErrors?: { row: number; message: string }[];
};

export const PAYMENT_REQUEST_CREATE_UPLOAD_INIT: PaymentRequestCreateUploadState = { ok: true };
```

- [ ] **Step 2: 서버 액션 추가**

`src/app/(app)/expenses/payment-request/actions.ts` 상단 import 수정:

```ts
import {
  updatePaymentRequestsBulk, updatePaymentRequest, updatePaymentRequestPmFields,
  updatePaymentRequestsByIds, softDeletePaymentRequests, createPaymentRequestsFromUpload,
} from "@/lib/data/payment-requests";
import { buildPaymentRequestUpdatesFromRows } from "@/lib/data/payment-request-upload";
import { buildPaymentRequestRegistrationRowsFromXlsx } from "@/lib/data/payment-request-registration-upload";
import { parseXlsxToRows } from "../payees/xlsx";
import {
  paymentRequestUpdateSchema, paymentRequestUpdatePmSchema, paymentRequestBulkUpdateSchema,
} from "@/lib/validation/schemas";
import { SAVED, type ActionState } from "@/lib/action-state";
import type { PaymentRequestUploadState } from "./upload-state";
import type { PaymentRequestCreateUploadState } from "./create-upload-state";
```

파일 끝에 추가:

```ts
// PM 엑셀 대량 등록. 정산담당자 재업로드(uploadPaymentRequestUpdatesAction)와 달리 PM 전용이고,
// all-or-nothing으로 저장한다 — 형식 오류든 매칭 오류든 하나라도 있으면 아무것도 저장하지 않는다.
export async function uploadPaymentRequestCreatesAction(
  _prev: PaymentRequestCreateUploadState,
  formData: FormData,
): Promise<PaymentRequestCreateUploadState> {
  const user = await requireRole("PM");
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
    console.error("[payment-request create-upload] 파일 읽기 실패:", e);
    return { ok: false, error: "파일을 읽을 수 없습니다. 양식을 확인하세요." };
  }

  const { rows: parsedRows, errors: parseErrors } = buildPaymentRequestRegistrationRowsFromXlsx(rows);
  if (parseErrors.length > 0) {
    return { ok: false, error: "입력값을 확인해 주세요.", rowErrors: parseErrors };
  }
  if (parsedRows.length === 0) {
    return { ok: false, error: "등록할 데이터가 없습니다." };
  }

  let result: Awaited<ReturnType<typeof createPaymentRequestsFromUpload>>;
  try {
    result = await createPaymentRequestsFromUpload(ctx, user.id, parsedRows);
  } catch (e) {
    console.error("[payment-request create-upload] 등록 실패:", e);
    return { ok: false, error: "등록 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }
  if (!result.ok) {
    return { ok: false, error: "입력값을 확인해 주세요.", rowErrors: result.errors };
  }

  revalidatePath("/expenses");
  return { ok: true, message: `${result.created}건 등록`, created: result.created };
}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 4: 기존 테스트 회귀 확인**

Run: `npx vitest run`
Expected: PASS (전체 스위트 — 이 파일을 건드렸으니 관련 테스트 전체가 여전히 통과하는지 확인)

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/payment-request/create-upload-state.ts" "src/app/(app)/expenses/payment-request/actions.ts"
git commit -m "feat(payment-request): PM 엑셀 대량 등록 서버 액션 추가"
```

---

### Task 7: 업로드 모달 컴포넌트

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestExcelRegisterModal.tsx`

**Interfaces:**
- Consumes: `uploadPaymentRequestCreatesAction`, `PAYMENT_REQUEST_CREATE_UPLOAD_INIT`(Task 6), `FileDropzone`(`@/components/FileDropzone`, 기존).
- Produces: `function PaymentRequestExcelRegisterModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null` — Task 8(`PaymentRequestNewForm.tsx`)이 이 컴포넌트를 렌더링한다.

**Context:** `src/app/(app)/expenses/PayeeUploadModal.tsx`를 그대로 본뜬다(파일 드롭존 + 서식 다운로드 링크 + 업로드 버튼 + 행별 오류 목록). 기존 `PaymentRequestExcelUploadModal.tsx`(정산담당자의 지급일/지급여부 재업로드 전용)와는 이름이 겹치지 않게 `...Register...`로 짓는다 — 서로 다른 기능이므로 절대 같은 파일을 재사용/수정하지 않는다. 컴포넌트 자동 테스트는 이 저장소 관례상 없다.

- [ ] **Step 1: 구현**

`src/app/(app)/expenses/PaymentRequestExcelRegisterModal.tsx` 신규 생성:

```tsx
"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileDropzone } from "@/components/FileDropzone";
import { uploadPaymentRequestCreatesAction } from "./payment-request/actions";
import { PAYMENT_REQUEST_CREATE_UPLOAD_INIT } from "./payment-request/create-upload-state";

// PM 등록 화면 전용 엑셀 대량 등록 모달. 정산담당자의 지급일/지급여부 재업로드용
// PaymentRequestExcelUploadModal과는 별개 기능/파일이다.
export function PaymentRequestExcelRegisterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(uploadPaymentRequestCreatesAction, PAYMENT_REQUEST_CREATE_UPLOAD_INIT);

  // 등록이 1건이라도 성공하면 목록 갱신 + 모달 닫기(all-or-nothing이라 성공하면 오류 목록이 없다).
  useEffect(() => {
    if (state.ok && state.created && state.created > 0) {
      router.refresh();
      onClose();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">📗 지급요청 엑셀 등록</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          지급요청 정보를 엑셀 양식에 맞춰 일괄 등록합니다. 한 행이라도 오류가 있으면 전체가 저장되지 않습니다.
        </p>

        <form action={formAction}>
          <FileDropzone name="file" accept=".xlsx" hint="지원 확장자: .xlsx" />

          <p className="mt-3 rounded bg-[var(--color-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
            업로드 항목: 지급명의, 고객사명, 사업자명(이름), 고유번호, 연락처, 사업자번호(주민등록번호), 은행명, 계좌번호, 예금주, 단가, 교통비, 재료비, 횟수, 청구방식, 상세내역
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

          <div className="mt-5 flex items-center justify-between">
            <a
              href="/expenses/payment-request/registration-template"
              className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
            >
              ⬇ 엑셀 서식 다운로드
            </a>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60"
            >
              {pending ? "업로드 중..." : "⬆ 업로드 실행"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestExcelRegisterModal.tsx"
git commit -m "feat(payment-request): PM 엑셀 등록 업로드 모달 컴포넌트 추가"
```

---

### Task 8: PM 등록 화면에 모달 연결

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestNewForm.tsx`

**Interfaces:**
- Consumes: `PaymentRequestExcelRegisterModal`(Task 7).
- Produces: 없음(최종 UI 배선).

**Context:** 현재 `handleExcelUpload`가 `alert("추후 구현 예정입니다.")` 스텁이다(53~55행). 이 스텁을 지우고 모달 열림 상태로 교체한다.

- [ ] **Step 1: 구현**

`src/app/(app)/expenses/PaymentRequestNewForm.tsx` 수정. import 추가:

```tsx
import { PaymentRequestExcelRegisterModal } from "./PaymentRequestExcelRegisterModal";
```

`useState` 추가(기존 `isSaving` state 선언 다음 줄):

```tsx
  const [isUploadOpen, setIsUploadOpen] = useState(false);
```

`handleExcelUpload` 함수(53~55행) 삭제:

```tsx
  function handleExcelUpload() {
    alert("추후 구현 예정입니다.");
  }
```

버튼의 `onClick`을 교체:

```tsx
          <button type="button" onClick={() => setIsUploadOpen(true)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            엑셀 업로드
          </button>
```

`return` 블록 마지막(`</div>` 최상위 컨테이너가 닫히기 직전)에 모달 렌더링 추가:

```tsx
      <PaymentRequestExcelRegisterModal open={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
```

전체 파일이 다음과 같은 구조가 되어야 한다(발췌):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PayeeOption } from "@/lib/data/payees";
import { PaymentRequestRowsTable, newDraftRow, type DraftRow } from "./PaymentRequestRowsTable";
import { createPaymentRequests } from "./actions";
import { validateDraftRows, toPaymentRequestCreateInputs } from "@/lib/payment-request-validation";
import { PaymentRequestExcelRegisterModal } from "./PaymentRequestExcelRegisterModal";

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
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  async function handleSave() {
    // ...기존 그대로...
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">지급요청 등록</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => setIsUploadOpen(true)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
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

      {saveError && <p className="mb-3 text-sm text-[var(--color-danger)]">{saveError}</p>}

      <PaymentRequestRowsTable rows={rows} onRowsChange={setRows} clients={clients} payees={payees} rowErrors={rowErrors} />

      <PaymentRequestExcelRegisterModal open={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 3: 기존 테스트 전체 회귀 확인**

Run: `npx vitest run`
Expected: PASS (전체 스위트)

- [ ] **Step 4: 수동 검증**

Run: `npm run dev`, PM 계정으로 로그인.

1. `/expenses/payment-request/new`에서 "엑셀 업로드" 클릭 → 모달이 뜨는지 확인(더 이상 `alert`가 아님).
2. 모달에서 "⬇ 엑셀 서식 다운로드" 클릭 → `지급요청_등록양식.xlsx`가 받아지는지 확인.
3. 받은 양식에 연동 행(등록된 지급 리스트의 고유번호 사용, 나머지 참고 컬럼은 비워둠) 1행 + 예외 행(고유번호/사업자번호 비우고 사업자명·청구방식 채움) 1행을 입력해 업로드 → 등록 성공 메시지, 목록 화면에서 두 건 다 확인(연동 행은 사업자명/청구방식이 지급 리스트 마스터 값과 일치하는지).
4. 오류가 섞인 파일(예: 존재하지 않는 고유번호 1행 + 정상 1행)을 업로드 → 아무것도 저장되지 않고 행별 오류 메시지가 보이는지 확인.
5. `.csv`나 `.xls` 파일을 업로드 시도 → "지원하지 않는 형식입니다" 오류 확인.

Expected: 위 5가지 모두 설계 문서대로 동작.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/expenses/PaymentRequestNewForm.tsx"
git commit -m "feat(payment-request): PM 등록 화면에 엑셀 업로드 모달 연결"
```
