# 지급리스트 PM 접근 권한(마스킹 뷰) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM 역할에게 `/expenses` 지급 리스트 탭을 열어주되, 사업자번호(주민등록번호) 대신 중간 4자리만 마스킹한 연락처를 보여주고 은행명/계좌번호/예금주는 전체 마스킹한 별도 화면을 제공한다.

**Architecture:** 기존 ADMIN/SETTLEMENT 전용 지급 리스트 코드 경로(`PayeeRow`/`listPayees`/`PayeeListPanel`/`PayeeRow.tsx`)는 건드리지 않고, PM 전용 마스킹 타입/함수/컴포넌트(`PayeePmRow`/`listPayeesForPm`/`PayeePmListPanel`/`PayeePmRow.tsx`)를 나란히 추가한다. 서버는 마스킹된 문자열만 계산해서 클라이언트로 내려보내며(원문은 서버 메모리에서만 잠깐 존재), 각 데이터 함수가 자신의 role 가드를 직접 갖는다(공용 조회 헬퍼 `fetchMatchedPayees`는 role 가드를 갖지 않는 내부 전용 함수로 남긴다).

**Tech Stack:** Next.js App Router(RSC + Server Actions), Prisma, Zod, Vitest.

## Global Constraints

- 엑셀 다운로드(`/expenses/payees/export`)와 첨부파일 다운로드(`getAttachmentDownloadUrlAction`)는 PM에게 계속 차단된다(`requireRole("SETTLEMENT")` 유지).
- 은행명/계좌번호/예금주 원문은 PM에게 전달되는 어떤 서버 응답/props에도 포함되지 않는다(RSC 페이로드 유출 방지 — 기존 `PayeeRow` 타입 주석의 원칙을 그대로 따름).
- PM의 인라인 편집은 사업자명·청구방식만 가능하다. 은행명/계좌번호/예금주 수정은 PM에게 열지 않는다.
- PM은 첨부파일을 업로드·교체할 수 있지만 다운로드·삭제는 할 수 없다.
- 기존 ADMIN/SETTLEMENT 화면(`PayeeRow`, `PayeeListPanel`, `listPayees`, `updatePayee`)의 동작은 변경하지 않는다.

---

### Task 1: 마스킹 헬퍼 (`maskPhone`, `maskFully`)

**Files:**
- Modify: `src/lib/crypto/payee-secret.ts`
- Test: `test/payee-secret.test.ts`

**Interfaces:**
- Produces: `maskPhone(digits: string): string`, `maskFully(value: string): string` — 이후 Task 4(`listPayeesForPm`)가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/payee-secret.test.ts` 파일 끝(마지막 `it` 블록 뒤, `});` 앞)에 아래 테스트를 추가한다:

```ts
  it("maskPhone: 뒤 4자리 앞까지 중간 4자리만 마스킹", () => {
    expect(maskPhone("01012345678")).toBe("010-****-5678"); // 11자리(휴대폰)
    expect(maskPhone("0212345678")).toBe("02-****-5678");   // 10자리(서울 유선)
    expect(maskPhone("021234567")).toBe("0-****-4567");     // 9자리(최소 자릿수)
  });
  it("maskFully: 값 길이만큼 전체 마스킹", () => {
    expect(maskFully("국민은행")).toBe("****");
    expect(maskFully("110123456789")).toBe("************");
    expect(maskFully("예금주")).toBe("***");
  });
```

그리고 파일 상단 import에 `maskPhone, maskFully`를 추가한다:

```ts
import {
  encrypt, decrypt, blindIndex, digitsOnly, derivePayeeType, maskBizNumber, maskAccountNumber,
  maskPhone, maskFully,
  PayeeKeyConfigError,
} from "@/lib/crypto/payee-secret";
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/payee-secret.test.ts`
Expected: FAIL — `maskPhone`/`maskFully`가 존재하지 않는다는 에러.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/crypto/payee-secret.ts`의 `maskAccountNumber` 함수(파일 끝) 바로 뒤에 추가:

```ts
// 연락처: 뒤 4자리 앞까지는 그대로 두고 중간 4자리만 마스킹. 010-****-5678
export function maskPhone(digits: string): string {
  const headLen = Math.max(digits.length - 8, 0);
  return `${digits.slice(0, headLen)}-****-${digits.slice(-4)}`;
}

// 길이 기반 전체 마스킹(은행명/계좌번호/예금주 공용). 값이 있었다는 사실 외에는 아무 정보도 남기지 않는다.
export function maskFully(value: string): string {
  return "*".repeat(value.length);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/payee-secret.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/crypto/payee-secret.ts test/payee-secret.test.ts
git commit -m "feat(payees): PM 마스킹용 연락처/전체 마스킹 헬퍼 추가"
```

---

### Task 2: 지급 리스트 탭 PM 접근 허용

**Files:**
- Modify: `src/app/(app)/expenses/tabs.ts:22-32`
- Test: `test/tabs.test.ts` (신규)

**Interfaces:**
- Consumes: 없음(기존 `EXPENSE_TABS`/`roleCanAccess` 구조 그대로).
- Produces: `payment-list` 탭이 `canAccessExpenseTab("PM", "payment-list")` / `visibleExpenseTabs("PM")`에서 true/포함되도록 변경.

- [ ] **Step 1: 실패하는 테스트 작성**

신규 파일 `test/tabs.test.ts` 작성:

```ts
import { describe, it, expect } from "vitest";
import { canAccessExpenseTab, visibleExpenseTabs, DEFAULT_EXPENSE_TAB } from "@/app/(app)/expenses/tabs";

describe("지급 리스트 탭 PM 접근", () => {
  it("PM도 payment-list 탭에 접근 가능하다", () => {
    expect(canAccessExpenseTab("PM", "payment-list")).toBe(true);
  });
  it("PM의 visibleExpenseTabs에 payment-list가 포함된다", () => {
    const keys = visibleExpenseTabs("PM").map((t) => t.key);
    expect(keys).toContain("payment-list");
  });
  it("ADMIN/SETTLEMENT는 기존과 동일하게 접근 가능하다", () => {
    expect(canAccessExpenseTab("ADMIN", "payment-list")).toBe(true);
    expect(canAccessExpenseTab("SETTLEMENT", "payment-list")).toBe(true);
  });
  it("기본 탭은 변경되지 않는다", () => {
    expect(DEFAULT_EXPENSE_TAB).toBe("all");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/tabs.test.ts`
Expected: FAIL — `PM도 payment-list 탭에 접근 가능하다` 케이스가 `false`로 실패.

- [ ] **Step 3: 최소 구현 작성**

`src/app/(app)/expenses/tabs.ts:22-25`를 다음과 같이 수정한다(주석 갱신 + `pmScoped: true` 추가):

```ts
export const EXPENSE_TABS: readonly ExpenseTab[] = [
  { key: "all", label: "전체 내역", roles: ["ADMIN", "SETTLEMENT"], pmScoped: true },
  // 지급 리스트는 전사 공용 원장이지만 PM에게는 마스킹된 뷰(연락처/은행명/계좌번호/예금주 마스킹,
  // 편집은 사업자명·청구방식만)로 노출한다. 원문 뷰(PayeeListPanel)는 여전히 ADMIN/SETTLEMENT 전용.
  { key: "payment-list", label: "지급 리스트", roles: ["ADMIN", "SETTLEMENT"], pmScoped: true },
```

(나머지 탭 정의는 그대로 둔다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/tabs.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/\(app\)/expenses/tabs.ts test/tabs.test.ts
git commit -m "feat(payees): 지급 리스트 탭 PM 접근 허용(pmScoped)"
```

---

### Task 3: 검색 필드 확장 + role 가드 재배치

**Files:**
- Modify: `src/lib/data/payees.ts:1-13` (검색 필드), `:171-227` (`fetchMatchedPayees`/`listPayees`/`listPayeesForExport`)
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Produces: `PAYEE_SEARCH_FIELDS_PM: readonly ["bizName","keyId","phone"]`, `PayeePmSearchField`, `parsePayeePmSearchField(value?: string): PayeePmSearchField | undefined`. `PayeeSearchFilter.field`가 `"phone"`도 허용하도록 확장.
- Consumes: 없음(기존 `listPayees`/`listPayeesForExport` 시그니처 유지).

**배경:** 지금은 `fetchMatchedPayees` 하나에만 role 가드가 있고 `listPayees`/`listPayeesForExport`는 그 가드에 암묵적으로 얹혀 있다. Task 4에서 `fetchMatchedPayees`를 PM도 호출해야 하므로, 가드를 각 공개 함수(`listPayees`, `listPayeesForExport`)로 옮겨 PM이 이 두 함수를 직접 호출해도 여전히 거부되게 만든다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payees.test.ts`의 `describe("payees 데이터 계층", ...)` 블록 안, `it("listPayees: 사업자번호 검색어가 6자리를 넘으면...")` 테스트 뒤에 추가:

```ts
  it("listPayees는 SETTLEMENT/ADMIN 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    await expect(
      listPayees({ userId: "pm1", role: "PM" }),
    ).rejects.toThrow("지급 리스트 원문 조회 권한이 없습니다.");
  });

  it("listPayees: 연락처 검색 필드는 PM 전용이라 listPayees에서는 무시된다(파싱 단계에서 걸러짐)", () => {
    expect(parsePayeeSearchField("phone")).toBeUndefined();
    expect(parsePayeePmSearchField("phone")).toBe("phone");
    expect(parsePayeePmSearchField("bizNumber")).toBeUndefined();
  });
```

파일 상단 import에 `parsePayeePmSearchField` 추가:

```ts
import {
  createPayeesBulk, listPayees, listPayeesForExport, findPayeeByBizNumber, parsePayeeSearchField,
  parsePayeePmSearchField,
  updatePayee, softDeletePayees,
  type PayeeCreateInput,
} from "@/lib/data/payees";
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: FAIL — `parsePayeePmSearchField`가 없어 import 에러, 그리고 `listPayees`가 PM을 거부하지 않아 실패.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payees.ts:6-13`를 다음으로 교체:

```ts
export const PAYEE_SEARCH_FIELDS = ["bizName", "bizNumber", "keyId"] as const;
export type PayeeSearchField = (typeof PAYEE_SEARCH_FIELDS)[number];

// PM 화면 전용 검색 필드 — 사업자번호 대신 연락처를 검색할 수 있다.
export const PAYEE_SEARCH_FIELDS_PM = ["bizName", "keyId", "phone"] as const;
export type PayeePmSearchField = (typeof PAYEE_SEARCH_FIELDS_PM)[number];

export type PayeeSearchFilter = { field: PayeeSearchField | PayeePmSearchField; q: string };

// 알 수 없는 field 값(URL 조작 등)은 undefined 반환 — 호출부가 필터를 완전히 무시하도록.
export function parsePayeeSearchField(value: string | undefined): PayeeSearchField | undefined {
  return PAYEE_SEARCH_FIELDS.find((f) => f === value);
}

export function parsePayeePmSearchField(value: string | undefined): PayeePmSearchField | undefined {
  return PAYEE_SEARCH_FIELDS_PM.find((f) => f === value);
}
```

`src/lib/data/payees.ts:171-193`(`fetchMatchedPayees`)를 다음으로 교체(role 가드 제거 + `phone` 검색 분기 추가):

```ts
// listPayees/listPayeesForExport/listPayeesForPm 공통: 조회 + 인메모리 검색 필터링.
// role 가드는 두지 않는다(모듈 내부 전용 함수) — 각 공개 함수가 자기 role을 직접 검증한다.
function fetchMatchedPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<MatchedPayee[]> {
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
      if (filter.field === "phone") {
        // 검색어가 URL 쿼리스트링에 그대로 남으므로, 사업자번호 검색과 동일한 이유로 앞 6자리까지만 사용한다.
        const qDigits = digitsOnly(q).slice(0, 6);
        return r.phoneNormalized.includes(qDigits);
      }
      // 검색어가 URL 쿼리스트링에 그대로 남으므로(GET 폼), 원문 전체 노출 위험을 줄이기 위해
      // 사업자번호 검색은 앞 6자리까지만 사용한다.
      const qDigits = digitsOnly(q).slice(0, 6);
      return digitsOnly(decrypt(r.bizNumberEnc)).includes(qDigits);
    });
  });
}
```

`src/lib/data/payees.ts:195-211`(`listPayees`)을 다음으로 교체(자체 role 가드 추가):

```ts
export async function listPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeRow[]> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  const rows = await fetchMatchedPayees(ctx, filter);
  return rows.map((r) => ({
    id: r.id,
    keyId: r.keyId,
    payeeType: r.payeeType,
    bizName: r.bizName,
    bizNumberMasked: r.bizNumberMasked,
    phone: r.phone,
    bankName: r.bankName,
    accountNumber: decrypt(r.accountNumberEnc),
    accountHolder: r.accountHolder,
    taxType: r.taxType,
    hasBizCert: r.attachments.some((a) => a.fileType === "BIZ_CERT"),
    hasBankbook: r.attachments.some((a) => a.fileType === "BANKBOOK"),
  }));
}
```

`src/lib/data/payees.ts:213-227`(`listPayeesForExport`)을 다음으로 교체(자체 role 가드 추가):

```ts
export async function listPayeesForExport(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeExportRow[]> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  const rows = await fetchMatchedPayees(ctx, filter);
  return rows.map((r) => ({
    keyId: r.keyId,
    bizName: r.bizName,
    bizNumber: decrypt(r.bizNumberEnc),
    phone: r.phone,
    bankName: r.bankName,
    accountNumber: decrypt(r.accountNumberEnc),
    accountHolder: r.accountHolder,
    taxType: r.taxType,
    hasBizCert: r.attachments.some((a) => a.fileType === "BIZ_CERT"),
    hasBankbook: r.attachments.some((a) => a.fileType === "BANKBOOK"),
  }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS (기존 `listPayeesForExport는 SETTLEMENT/ADMIN 외 역할은 거부한다` 테스트도 계속 통과해야 한다 — 에러 메시지를 그대로 재사용했기 때문).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "refactor(payees): role 가드를 공개 함수 단위로 재배치 + 연락처 검색 필드 추가"
```

---

### Task 4: PM 마스킹 조회 (`listPayeesForPm`)

**Files:**
- Modify: `src/lib/data/payees.ts` (Task 3에서 수정한 파일에 이어서, `listPayeesForExport` 함수 뒤)
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Consumes: `maskPhone`, `maskFully`(Task 1), `PAYEE_SEARCH_FIELDS_PM`/`PayeePmSearchField`(Task 3), `digitsOnly`, `decrypt`(기존 import).
- Produces: `PayeePmRow` 타입, `listPayeesForPm(ctx, filter?): Promise<PayeePmRow[]>` — Task 9(`PayeePmListPanel`)가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payees.test.ts`에 (Task 3에서 추가한 테스트들 뒤, `updatePayee` 테스트 그룹 앞 정도에) 추가:

```ts
  it("listPayeesForPm: PM 아닌 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    await expect(
      listPayeesForPm(ADMIN),
    ).rejects.toThrow("PM 지급 리스트 조회 권한이 없습니다.");
  });

  it("listPayeesForPm: 연락처는 중간 4자리만, 은행명/계좌번호/예금주는 전체 마스킹해 반환한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Acme")]);
    const PM = { userId: "pm1", role: "PM" as const };
    const [row] = await listPayeesForPm(PM);

    expect(row.bizName).toBe("Acme");
    expect(row.phoneMasked).toBe("010-****-5678"); // input()의 phone은 "010-1234-5678"
    expect(row.bankNameMasked).toBe("**"); // input()의 bankName은 "국민"(2자)
    expect(row.accountNumberMasked).toBe("************"); // acct = "110123456789"(12자리)
    expect(row.accountHolderMasked).toBe("***"); // "예금주"(3자)
    expect(row.taxType).toBe("TAX_INVOICE");

    // 원문이 어떤 필드에도 담기지 않는지 키 목록으로 확인.
    expect(Object.keys(row)).not.toContain("bankName");
    expect(Object.keys(row)).not.toContain("accountNumber");
    expect(Object.keys(row)).not.toContain("accountHolder");
    expect(Object.keys(row)).not.toContain("phone");
  });

  it("listPayeesForPm: 연락처 검색으로 조회할 수 있다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]); // phone: 010-1234-5678
    const PM = { userId: "pm1", role: "PM" as const };
    const hit = await listPayeesForPm(PM, { field: "phone", q: "010123" });
    expect(hit).toHaveLength(1);
    const miss = await listPayeesForPm(PM, { field: "phone", q: "999999" });
    expect(miss).toHaveLength(0);
  });
```

파일 상단 import에 `listPayeesForPm` 추가:

```ts
import {
  createPayeesBulk, listPayees, listPayeesForExport, listPayeesForPm, findPayeeByBizNumber,
  parsePayeeSearchField, parsePayeePmSearchField,
  updatePayee, softDeletePayees,
  type PayeeCreateInput,
} from "@/lib/data/payees";
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: FAIL — `listPayeesForPm`가 존재하지 않는다는 에러.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payees.ts` 상단 import를 다음으로 교체(마스킹 헬퍼 추가):

```ts
import { decrypt, encrypt, blindIndex, digitsOnly, maskAccountNumber, maskPhone, maskFully } from "@/lib/crypto/payee-secret";
```

`listPayeesForExport` 함수(Task 3에서 수정한 버전) 바로 뒤에 추가:

```ts
// PM용 지급 리스트 화면 — 사업자번호/주민번호 대신 연락처(중간 4자리 마스킹),
// 은행명/계좌번호/예금주는 값 길이만큼 전체 마스킹. 원문은 어떤 필드에도 담기지 않는다.
export type PayeePmRow = {
  id: string;
  keyId: string;
  payeeType: PayeeType;
  bizName: string;
  phoneMasked: string;
  bankNameMasked: string;
  accountNumberMasked: string;
  accountHolderMasked: string;
  taxType: TaxType;
  hasBizCert: boolean;
  hasBankbook: boolean;
};

export async function listPayeesForPm(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeePmRow[]> {
  if (ctx.role !== "PM") {
    throw new Error("PM 지급 리스트 조회 권한이 없습니다.");
  }
  const rows = await fetchMatchedPayees(ctx, filter);
  return rows.map((r) => ({
    id: r.id,
    keyId: r.keyId,
    payeeType: r.payeeType,
    bizName: r.bizName,
    phoneMasked: maskPhone(digitsOnly(r.phone)),
    bankNameMasked: maskFully(r.bankName),
    accountNumberMasked: maskFully(decrypt(r.accountNumberEnc)),
    accountHolderMasked: maskFully(r.accountHolder),
    taxType: r.taxType,
    hasBizCert: r.attachments.some((a) => a.fileType === "BIZ_CERT"),
    hasBankbook: r.attachments.some((a) => a.fileType === "BANKBOOK"),
  }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payees): PM용 마스킹 조회(listPayeesForPm) 추가"
```

---

### Task 5: PM 부분 수정 (사업자명·청구방식만)

**Files:**
- Modify: `src/lib/data/payees.ts` (`updatePayee` 함수 뒤, Task 4에서 추가한 부분 이어서)
- Modify: `src/lib/validation/schemas.ts:138-145`
- Modify: `src/app/(app)/expenses/payees/actions.ts`
- Test: `test/data-payees.test.ts`, `test/schemas.test.ts`

**Interfaces:**
- Consumes: `TaxType`(Prisma), `withRLS`, `RlsContext`(기존 import).
- Produces: `PayeeUpdatePmInput` 타입, `updatePayeePmFields(ctx, id, input): Promise<void>`(데이터 계층) / `updatePayeePmAction(id, formData): Promise<ActionState>`(서버 액션) — Task 9(`PayeePmRow.tsx`)가 액션을 사용.

- [ ] **Step 1: 실패하는 테스트 작성 (데이터 계층 + 스키마)**

`test/data-payees.test.ts`의 `updatePayee` 테스트 그룹(`it("updatePayee: 이름/은행명/계좌번호/예금주/청구방식을 갱신한다", ...)` 부근) 뒤에 추가:

```ts
  it("updatePayeePmFields: 사업자명/청구방식만 바뀌고 은행명/계좌번호/예금주는 그대로다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Old Name")]);
    const PM = { userId: "pm1", role: "PM" as const };
    const [row] = await listPayeesForPm(PM);

    await updatePayeePmFields(PM, row.id, { bizName: "New Name", taxType: "OTHER_INCOME" });

    const [after] = await listPayeesForPm(PM);
    expect(after.bizName).toBe("New Name");
    expect(after.taxType).toBe("OTHER_INCOME");
    // 마스킹 값이 그대로인지(=은행명/계좌번호/예금주 원문이 안 바뀌었는지) 확인.
    expect(after.bankNameMasked).toBe(row.bankNameMasked);
    expect(after.accountNumberMasked).toBe(row.accountNumberMasked);
    expect(after.accountHolderMasked).toBe(row.accountHolderMasked);
  });

  it("updatePayeePmFields는 PM 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);
    await expect(
      updatePayeePmFields(ADMIN, row.id, { bizName: "x", taxType: "OTHER_INCOME" }),
    ).rejects.toThrow("PM 지급 리스트 수정 권한이 없습니다.");
  });
```

import에 `updatePayeePmFields` 추가(Task 4에서 수정한 import 줄에 이어서).

`test/schemas.test.ts`의 `describe("payeeUpdateSchema", ...)` 블록 뒤에 추가:

```ts
describe("payeeUpdatePmSchema", () => {
  it("사업자명/청구방식만으로 통과", () => {
    expect(payeeUpdatePmSchema.safeParse({ bizName: "홍길동", taxType: "사업소득" }).success).toBe(true);
  });
  it("이름이 비어있으면 실패", () => {
    expect(payeeUpdatePmSchema.safeParse({ bizName: "", taxType: "사업소득" }).success).toBe(false);
  });
  it("알 수 없는 청구방식은 실패", () => {
    expect(payeeUpdatePmSchema.safeParse({ bizName: "홍길동", taxType: "카드" }).success).toBe(false);
  });
});
```

import에 `payeeUpdatePmSchema` 추가.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/data-payees.test.ts test/schemas.test.ts`
Expected: FAIL — `updatePayeePmFields`/`payeeUpdatePmSchema`가 존재하지 않는다는 에러.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payees.ts`의 `updatePayee` 함수(Task 3 기준 원본 그대로, 파일 내 `export function updatePayee(...)` 블록) 바로 뒤에 추가:

```ts
// PM 전용 부분 수정 — 사업자명/청구방식만 바꾼다. 은행명/계좌번호/예금주는 data에 넣지 않으므로 그대로 유지된다.
export type PayeeUpdatePmInput = { bizName: string; taxType: TaxType };

export function updatePayeePmFields(ctx: RlsContext, id: string, input: PayeeUpdatePmInput): Promise<void> {
  return withRLS(ctx, async (tx) => {
    if (ctx.role !== "PM") {
      throw new Error("PM 지급 리스트 수정 권한이 없습니다.");
    }
    await tx.payee.update({ where: { id }, data: { bizName: input.bizName, taxType: input.taxType } });
  });
}
```

`src/lib/validation/schemas.ts:138-145`(`payeeUpdateSchema`) 바로 뒤에 추가:

```ts

// PM 인라인 수정용 — 사업자명/청구방식만 다룬다.
export const payeeUpdatePmSchema = z.object({
  bizName: z.string().trim().min(1, "이름은 필수입니다."),
  taxType: z.enum(TAX_TYPE_LABELS),
});
```

`src/app/(app)/expenses/payees/actions.ts`의 import 줄(1-13)을 다음으로 교체:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { createPayeesBulk, updatePayee, updatePayeePmFields, softDeletePayees } from "@/lib/data/payees";
import { PayeeKeyConfigError } from "@/lib/crypto/payee-secret";
import { TAX_TYPE_BY_LABEL } from "@/lib/labels";
import { payeeUpdateSchema, payeeUpdatePmSchema } from "@/lib/validation/schemas";
import { SAVED, type ActionState } from "@/lib/action-state";
import { buildPayeeInputsFromCsv, buildPayeeInputsFromRows, type BuildResult } from "./build-inputs";
import { parseXlsxToRows } from "./xlsx";
import type { PayeeUploadState } from "./upload-state";
```

`updatePayeeAction` 함수(현재 71-102줄) 바로 뒤에 추가:

```ts

export async function updatePayeePmAction(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);

  const parsed = payeeUpdatePmSchema.safeParse({
    bizName: formData.get("bizName"),
    taxType: formData.get("taxType"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  }
  const d = parsed.data;

  try {
    await updatePayeePmFields(ctx, id, { bizName: d.bizName, taxType: TAX_TYPE_BY_LABEL[d.taxType] });
  } catch (e) {
    console.error("[payee update-pm] 수정 실패:", e);
    return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/data-payees.test.ts test/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts src/lib/validation/schemas.ts src/app/\(app\)/expenses/payees/actions.ts test/data-payees.test.ts test/schemas.test.ts
git commit -m "feat(payees): PM 인라인 수정(사업자명/청구방식) 추가"
```

---

### Task 6: 등록/삭제 권한을 PM까지 완화

**Files:**
- Modify: `src/app/(app)/expenses/payees/actions.ts` (`uploadPayeesAction`, `deletePayeesAction`)
- Modify: `src/lib/data/payees.ts` (`softDeletePayees`)
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Consumes: 없음(기존 시그니처 유지).
- Produces: 없음(동작 변경만).

**배경:** `softDeletePayees`의 role 가드를 ADMIN/SETTLEMENT/PM 전부 허용하도록 넓히면 `AppRole`의 모든 값이 통과하게 되어 가드 자체가 무의미해진다. 가드를 지워 "삭제는 로그인한 어떤 역할이든 가능"함을 명확히 하고, 실제 인가는 서버 액션의 `requireRole("PM")`(=랭크 무관 통과)에 맡긴다. 반면 `updatePayee`(전체 필드 수정)는 PM을 계속 막아야 하므로 그 가드는 그대로 둔다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payees.test.ts`의 `it("softDeletePayees는 SETTLEMENT/ADMIN 외 역할은 거부한다", ...)` 테스트를 **아래 내용으로 교체**한다(더는 PM을 거부하지 않으므로):

```ts
  it("softDeletePayees는 PM도 삭제할 수 있다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const [row] = await listPayees(ADMIN);

    const res = await softDeletePayees({ userId: "pm1", role: "PM" }, [row.id]);
    expect(res.ok).toBe(true);
    expect(await listPayees(ADMIN)).toHaveLength(0);
  });
```

(`updatePayee는 SETTLEMENT/ADMIN 외 역할은 거부한다` 테스트는 변경하지 않는다 — `updatePayee`는 여전히 PM을 막아야 한다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: FAIL — 현재 `softDeletePayees`가 PM을 "지급 리스트 삭제 권한이 없습니다."로 거부하므로 `res.ok`가 아니라 예외가 던져져 실패.

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payees.ts`의 `softDeletePayees` 함수에서 role 가드 블록을 제거한다:

```ts
// 지급 리스트 소프트 삭제 — 개별/일괄 모두 이 함수 하나로 처리(ids 길이 1 또는 N).
// 이미 삭제됐거나 존재하지 않는 id가 섞여도 나머지는 정상 삭제되고, count가 0일 때만 실패로 본다.
// role 가드 없음 — ADMIN/SETTLEMENT/PM 모두 삭제 가능(서버 액션의 requireRole("PM")이 인가를 맡는다).
export function softDeletePayees(ctx: RlsContext, ids: string[]): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const result = await tx.payee.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) return { ok: false, error: "삭제할 항목을 찾을 수 없습니다." };
    return { ok: true };
  });
}
```

`src/app/(app)/expenses/payees/actions.ts`에서 `uploadPayeesAction`과 `deletePayeesAction`의 `requireRole("SETTLEMENT")`를 `requireRole("PM")`으로 바꾼다(각 함수 첫 줄, 주석 `// ADMIN도 랭크상 통과`는 `// ADMIN/SETTLEMENT도 랭크상 통과`로 갱신):

```ts
  const user = await requireRole("PM"); // ADMIN/SETTLEMENT도 랭크상 통과
```

(이 줄은 `uploadPayeesAction`과 `deletePayeesAction` 두 곳에 각각 적용한다. `updatePayeeAction`은 `requireRole("SETTLEMENT")` 그대로 둔다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts src/app/\(app\)/expenses/payees/actions.ts test/data-payees.test.ts
git commit -m "feat(payees): 지급 리스트 등록/삭제 권한을 PM까지 완화"
```

---

### Task 7: 첨부파일 액션 — PM 업로드/교체 허용, 다운로드/삭제는 차단

**Files:**
- Modify: `src/app/(app)/expenses/payees/attachment-actions.ts`

**Interfaces:**
- Consumes: 없음(기존 `saveAttachmentsCore`/`getDownloadUrlCore` 시그니처 유지).
- Produces: 없음(동작 변경만). 이 파일의 함수들은 기존에도 단위 테스트가 없다(핵심 로직은 `attachment-core.ts`의 `saveAttachmentsCore`/`getDownloadUrlCore`에서 이미 커버됨) — 이번 변경은 `requireRole` 대상만 바꾸는 얇은 래퍼 수정이라 새 테스트를 추가하지 않고 Task 11(수동 검증)에서 확인한다.

- [ ] **Step 1: 변경 적용**

`src/app/(app)/expenses/payees/attachment-actions.ts` 전체를 다음으로 교체:

```ts
"use server";

import type { PayeeFileType } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { revalidatePath } from "next/cache";
import { getPayeeAttachments } from "@/lib/data/payee-attachments";
import { saveAttachmentsCore, getDownloadUrlCore } from "./attachment-core";
import type { PayeeAttachmentSaveState } from "./attachment-state";

export async function getPayeeAttachmentsAction(payeeId: string): Promise<{
  bizCert: { fileName: string } | null;
  bankbook: { fileName: string } | null;
}> {
  const user = await requireRole("PM"); // ADMIN/SETTLEMENT도 랭크상 통과. 파일명만 반환하므로 PM도 열람 가능.
  const ctx = getRlsContext(user);
  const pair = await getPayeeAttachments(ctx, payeeId);
  return {
    bizCert: pair.bizCert ? { fileName: pair.bizCert.fileName } : null,
    bankbook: pair.bankbook ? { fileName: pair.bankbook.fileName } : null,
  };
}

export async function saveAttachmentsAction(
  _prev: PayeeAttachmentSaveState,
  formData: FormData,
): Promise<PayeeAttachmentSaveState> {
  const user = await requireRole("PM"); // ADMIN/SETTLEMENT도 랭크상 통과.
  // PM은 업로드/교체만 가능하고 삭제는 불가 — 클라이언트가 hidden input을 조작해도 서버에서 무력화한다.
  if (user.role === "PM") {
    formData.delete("bizCertDelete");
    formData.delete("bankbookDelete");
  }
  const ctx = getRlsContext(user);
  const result = await saveAttachmentsCore(ctx, formData);
  revalidatePath("/expenses");
  return result;
}

export async function getAttachmentDownloadUrlAction(
  payeeId: string,
  fileType: PayeeFileType,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireRole("SETTLEMENT"); // 다운로드는 PM에게 계속 차단(통장사본/사업자등록증에 원문 노출).
  const ctx = getRlsContext(user);
  return getDownloadUrlCore(ctx, payeeId, fileType);
}
```

- [ ] **Step 2: 타입체크 확인**

Run: `npx tsc --noEmit`
Expected: 이 파일 관련 에러 없음(`user.role`이 `AppRole`이라 `"PM"` 비교 가능).

- [ ] **Step 3: 커밋**

```bash
git add src/app/\(app\)/expenses/payees/attachment-actions.ts
git commit -m "feat(payees): 첨부파일 업로드/교체를 PM까지 허용, 다운로드/삭제는 계속 차단"
```

---

### Task 8: `PayeeAttachmentModal`에 `canDownload`/`canDelete` prop 추가

**Files:**
- Modify: `src/app/(app)/expenses/PayeeAttachmentModal.tsx`

**Interfaces:**
- Produces: `PayeeAttachmentModal` props에 `canDownload?: boolean`(기본 `true`), `canDelete?: boolean`(기본 `true`) 추가 — Task 9(`PayeePmListPanel`)가 `false`로 넘겨 사용.
- 기존 호출부(`PayeeListPanel.tsx`)는 prop을 넘기지 않으므로 기본값(`true`/`true`)으로 지금과 동일하게 동작한다.

- [ ] **Step 1: 변경 적용**

`src/app/(app)/expenses/PayeeAttachmentModal.tsx`의 컴포넌트 선언부(현재 14-22줄)를 다음으로 교체:

```tsx
export function PayeeAttachmentModal({
  open, payeeId, keyId, bizName, canDownload = true, canDelete = true, onClose,
}: {
  open: boolean;
  payeeId: string;
  keyId: string;
  bizName: string;
  canDownload?: boolean;
  canDelete?: boolean;
  onClose: () => void;
}) {
```

두 `<AttachmentSlot .../>` 호출(사업자등록증/통장사본, 현재 89-98줄과 103-112줄)에 각각 `canDownload={canDownload} canDelete={canDelete}`를 추가:

```tsx
            <AttachmentSlot
              label="사업자등록증(신분증 사본)"
              existing={bizCert}
              fieldName="bizCertFile"
              canDownload={canDownload}
              canDelete={canDelete}
              markedForDelete={bizCertDelete}
              onMarkDelete={setBizCertDelete}
              onDownload={() => handleDownload("BIZ_CERT", setBizCertDownloadError)}
              errorMessage={state.bizCertError}
              downloadError={bizCertDownloadError}
            />
```

```tsx
            <AttachmentSlot
              label="통장사본"
              existing={bankbook}
              fieldName="bankbookFile"
              canDownload={canDownload}
              canDelete={canDelete}
              markedForDelete={bankbookDelete}
              onMarkDelete={setBankbookDelete}
              onDownload={() => handleDownload("BANKBOOK", setBankbookDownloadError)}
              errorMessage={state.bankbookError}
              downloadError={bankbookDownloadError}
            />
```

`AttachmentSlot` 함수 선언부(현재 134-145줄)를 다음으로 교체:

```tsx
function AttachmentSlot({
  label, existing, fieldName, canDownload, canDelete, markedForDelete, onMarkDelete, onDownload, errorMessage, downloadError,
}: {
  label: string;
  existing: SlotState;
  fieldName: string;
  canDownload: boolean;
  canDelete: boolean;
  markedForDelete: boolean;
  onMarkDelete: (v: boolean) => void;
  onDownload: () => void;
  errorMessage?: string;
  downloadError?: string | null;
}) {
```

`AttachmentSlot`의 "기존 파일 있음" 분기(현재 162-176줄)를 다음으로 교체(다운로드/삭제 버튼을 조건부 렌더링):

```tsx
  if (existing && !replacing) {
    return (
      <div>
        <p className="mb-2 text-sm font-medium">{label}</p>
        <div className="flex items-center justify-between rounded border border-[var(--color-border)] px-3 py-2">
          <span className="truncate text-sm">{existing.fileName}</span>
          <div className="flex shrink-0 gap-2 text-sm">
            {canDownload && (
              <button type="button" onClick={onDownload} className="text-[var(--color-primary)] hover:underline">다운로드</button>
            )}
            <button type="button" onClick={() => setReplacing(true)} className="text-[var(--color-primary)] hover:underline">변경</button>
            {canDelete && (
              <button type="button" onClick={() => onMarkDelete(true)} className="text-[var(--color-danger)] hover:underline">삭제</button>
            )}
          </div>
        </div>
        {downloadError && <p className="mt-1 text-xs text-[var(--color-danger)]">{downloadError}</p>}
      </div>
    );
  }
```

- [ ] **Step 2: 타입체크 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/\(app\)/expenses/PayeeAttachmentModal.tsx
git commit -m "feat(payees): 첨부파일 모달에 canDownload/canDelete prop 추가"
```

---

### Task 9: PM 전용 UI — `PayeePmRow.tsx` / `PayeePmListPanel.tsx`

**Files:**
- Create: `src/app/(app)/expenses/PayeePmRow.tsx`
- Create: `src/app/(app)/expenses/PayeePmListPanel.tsx`

**Interfaces:**
- Consumes: `PayeePmRow`/`PayeePmSearchField` 타입(Task 3, 4), `updatePayeePmAction`(Task 5), `deletePayeesAction`(기존, Task 6에서 권한만 완화), `PayeeUploadModal`/`PayeeDeleteConfirmModal`(기존, 변경 없음), `PayeeAttachmentModal`의 `canDownload`/`canDelete` prop(Task 8).
- Produces: `PayeePmListPanel` 컴포넌트 — Task 10(`page.tsx`)이 사용.

- [ ] **Step 1: `PayeePmRow.tsx` 작성**

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxType } from "@prisma/client";
import type { PayeePmRow as PayeePmRowData } from "@/lib/data/payees";
import { TAX_TYPE_LABELS, taxTypeLabel } from "@/lib/labels";
import { updatePayeePmAction } from "./payees/actions";

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
  "w-full rounded border-2 border-[var(--color-primary)]/50 bg-[var(--color-surface)] px-2 py-1.5 text-center text-sm shadow-sm focus:border-[var(--color-primary)] focus:outline-none";
const cellCls = "whitespace-nowrap px-3 py-2 text-center align-middle";

export function PayeePmRow({
  row,
  isEditing,
  isSelected,
  onToggleSelect,
  onStartEdit,
  onStopEdit,
  onOpenAttachment,
  onRequestDelete,
}: {
  row: PayeePmRowData;
  isEditing: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onOpenAttachment: () => void;
  onRequestDelete: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const bizNameRef = useRef<HTMLInputElement>(null);
  const taxTypeRef = useRef<HTMLSelectElement>(null);

  function handleCancel() {
    setError(null);
    onStopEdit();
  }

  function handleSave() {
    const formData = new FormData();
    formData.set("bizName", bizNameRef.current!.value);
    formData.set("taxType", taxTypeRef.current!.value);

    setError(null);
    startTransition(async () => {
      const result = await updatePayeePmAction(row.id, formData);
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
      <td className={`${cellCls} font-medium text-[var(--color-primary)]`}>{row.keyId.toUpperCase()}</td>

      <td className={cellCls}>
        {isEditing ? <input ref={bizNameRef} className={inputCls} defaultValue={row.bizName} /> : row.bizName}
      </td>

      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.phoneMasked}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.bankNameMasked}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.accountNumberMasked}</td>
      <td className={`${cellCls} text-[var(--color-muted)]`}>{row.accountHolderMasked}</td>

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

- [ ] **Step 2: `PayeePmListPanel.tsx` 작성**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PayeePmRow as PayeePmRowData, PayeePmSearchField } from "@/lib/data/payees";
import { deletePayeesAction } from "./payees/actions";
import { PayeeUploadModal } from "./PayeeUploadModal";
import { PayeeAttachmentModal } from "./PayeeAttachmentModal";
import { PayeeDeleteConfirmModal } from "./PayeeDeleteConfirmModal";
import { PayeePmRow } from "./PayeePmRow";

const SEARCH_FIELD_OPTIONS: { value: PayeePmSearchField; label: string }[] = [
  { value: "bizName", label: "사업자명(이름)" },
  { value: "keyId", label: "고유번호" },
  { value: "phone", label: "연락처" },
];

export function PayeePmListPanel({
  rows,
  field,
  q,
}: {
  rows: PayeePmRowData[];
  field: PayeePmSearchField;
  q: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState<{ id: string; keyId: string; bizName: string } | null>(null);
  const [searchField, setSearchField] = useState<PayeePmSearchField>(field);
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

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

  function startEditing(id: string) {
    setEditing((prev) => new Set(prev).add(id));
  }

  function stopEditing(id: string) {
    setEditing((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="payment-list" />
          <span className="text-sm text-[var(--color-muted)]">검색:</span>
          <select
            name="field"
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as PayeePmSearchField)}
            className="rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            {SEARCH_FIELD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="검색어 입력"
            className="w-64 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">
            🔍 조회
          </button>
        </form>
        <div className="flex items-center gap-2">
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
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th className="w-10 whitespace-nowrap px-3 py-2 align-middle">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체선택" />
              </th>
              <th className="whitespace-nowrap px-3 py-2">고유번호</th>
              <th className="whitespace-nowrap px-3 py-2">사업자명(이름)</th>
              <th className="whitespace-nowrap px-3 py-2">연락처</th>
              <th className="whitespace-nowrap px-3 py-2">은행명</th>
              <th className="whitespace-nowrap px-3 py-2">계좌번호</th>
              <th className="whitespace-nowrap px-3 py-2">예금주</th>
              <th className="whitespace-nowrap px-3 py-2">청구방식</th>
              <th className="whitespace-nowrap px-3 py-2">첨부파일</th>
              <th className="whitespace-nowrap px-3 py-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PayeePmRow
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
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
          {q.trim() ? "검색 결과가 없습니다." : "등록된 지급 대상이 없습니다."}
        </p>
      )}

      {uploadOpen && <PayeeUploadModal open onClose={() => setUploadOpen(false)} />}
      {attachmentTarget && (
        <PayeeAttachmentModal
          open
          payeeId={attachmentTarget.id}
          keyId={attachmentTarget.keyId}
          bizName={attachmentTarget.bizName}
          canDownload={false}
          canDelete={false}
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

- [ ] **Step 3: 타입체크 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/app/\(app\)/expenses/PayeePmRow.tsx src/app/\(app\)/expenses/PayeePmListPanel.tsx
git commit -m "feat(payees): PM 전용 지급 리스트 UI(PayeePmRow/PayeePmListPanel) 추가"
```

---

### Task 10: `page.tsx` — 역할별 분기 연결

**Files:**
- Modify: `src/app/(app)/expenses/page.tsx:1-19` (import), `:130-144`(`PaymentListTab`)

**Interfaces:**
- Consumes: `listPayeesForPm`, `parsePayeePmSearchField`(Task 4, 3), `PayeePmListPanel`(Task 9).

- [ ] **Step 1: 변경 적용**

`src/app/(app)/expenses/page.tsx:6`의 import를 다음으로 교체:

```ts
import { listPayees, listPayeesForPm, parsePayeeSearchField, parsePayeePmSearchField } from "@/lib/data/payees";
```

`src/app/(app)/expenses/page.tsx:13` 뒤(다른 import들 사이, 알파벳/기존 순서 유지)에 추가:

```ts
import { PayeePmListPanel } from "./PayeePmListPanel";
```

`src/app/(app)/expenses/page.tsx:130-144`(`PaymentListTab`)를 다음으로 교체:

```tsx
// 지급 리스트 탭 본문 — 공용 원장. ADMIN·SETTLEMENT는 원문, PM은 마스킹된 뷰로 본다.
async function PaymentListTab({
  sp,
  user,
}: {
  sp: { field?: string; q?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);

  if (user.role === "PM") {
    const parsedField = parsePayeePmSearchField(sp.field);
    const field = parsedField ?? "bizName";
    const q = parsedField ? (sp.q ?? "") : "";
    const rows = await listPayeesForPm(ctx, parsedField && q.trim() ? { field: parsedField, q } : undefined);
    return <PayeePmListPanel rows={rows} field={field} q={q} />;
  }

  const parsedField = parsePayeeSearchField(sp.field);
  const field = parsedField ?? "bizName";
  const q = parsedField ? (sp.q ?? "") : "";
  const rows = await listPayees(ctx, parsedField && q.trim() ? { field: parsedField, q } : undefined);
  return <PayeeListPanel rows={rows} field={field} q={q} />;
}
```

- [ ] **Step 2: 타입체크 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 전체 테스트 스위트 확인**

Run: `npx vitest run`
Expected: 전체 PASS (이번 계획에서 건드린 파일 + 기존 테스트 전부).

- [ ] **Step 4: 커밋**

```bash
git add src/app/\(app\)/expenses/page.tsx
git commit -m "feat(payees): 지급 리스트 탭을 PM/ADMIN·SETTLEMENT로 분기"
```

---

### Task 11: 수동 검증

**Files:** 없음(코드 변경 없음).

이 작업은 `/run` 스킬(있다면)이나 `npm run dev`로 개발 서버를 띄워 브라우저에서 아래 시나리오를 눈으로 확인한다. 자동화된 인증/세션이 없는 로컬 환경이면 DB에서 테스트 계정의 `role`을 직접 바꿔가며 확인한다(`prisma studio` 또는 `psql`로 `User.role`을 `PM`/`SETTLEMENT`로 전환).

- [ ] **Step 1: 개발 서버 기동**

Run: `npm run dev`

- [ ] **Step 2: PM 계정으로 확인**
  - `/expenses?tab=payment-list` 접근이 더는 리다이렉트되지 않고 탭이 보인다.
  - 테이블 컬럼이 고유번호/사업자명/연락처/은행명/계좌번호/예금주/청구방식/첨부파일/관리 순서로 보인다.
  - 연락처가 `010-****-5678` 형태로, 은행명/계좌번호/예금주가 `*`로 전체 마스킹되어 보인다.
  - 검색 셀렉트에 사업자번호 옵션이 없고 사업자명/고유번호/연락처만 있다.
  - 엑셀 다운로드 버튼이 보이지 않는다.
  - ✏️ 편집 진입 시 사업자명 입력창과 청구방식 셀렉트만 활성화되고, 은행명/계좌번호/예금주 칸은 마스킹된 텍스트 그대로 고정돼 있다. 저장하면 사업자명/청구방식만 바뀐다.
  - 🗑️ 삭제, "+ 등록"(엑셀 업로드)이 정상 동작한다.
  - 첨부파일 배지를 클릭하면 모달에서 파일이 없을 때 업로드 드롭존이 뜨고, 파일이 있을 때는 "변경" 버튼만 보이고 "다운로드"/"삭제" 버튼은 보이지 않는다.
  - `/expenses/payees/export`를 직접 열면(주소창에 URL 입력) 차단(리다이렉트)된다.

- [ ] **Step 3: ADMIN/SETTLEMENT 계정으로 회귀 확인**
  - 기존과 동일하게 사업자번호(마스킹) 컬럼, 원문 은행명/계좌번호/예금주가 보인다.
  - 편집 시 은행명/계좌번호/예금주까지 전부 수정 가능하다.
  - 엑셀 다운로드, 첨부파일 다운로드/삭제가 정상 동작한다.

- [ ] **Step 4: 문제 없으면 계획 완료 — 별도 커밋 없음**

---

## 셀프 리뷰 메모 (계획 작성자용, 실행 불필요)

- 스펙 커버리지: 설계 문서(`docs/superpowers/specs/2026-07-29-payee-list-pm-access-design.md`)의 7개 섹션 모두 Task 1~10에 매핑됨. 문서 작성 중 발견한 `fetchMatchedPayees` 가드 이슈는 Task 3에서 반영.
- `softDeletePayees` 가드를 완전히 제거하는 결정은 설계 문서에 명시되지 않았던 추가 판단(모든 `AppRole` 값이 통과하게 되어 가드가 무의미해지는 문제) — Task 6에 배경 설명 포함.
- 타입/함수명 일관성: `PayeePmRow`(데이터 타입) vs `PayeePmRow`(컴포넌트)는 이름이 같지만 import 시 `PayeePmRow as PayeePmRowData`로 별칭 처리해 충돌 없음(기존 `PayeeRow`/`PayeeRow.tsx` 패턴과 동일).
