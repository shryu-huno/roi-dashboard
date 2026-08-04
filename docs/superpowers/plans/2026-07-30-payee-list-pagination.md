# 지급 리스트 페이지네이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/expenses?tab=payment-list` 화면(ADMIN/SETTLEMENT용 `PayeeListPanel`, PM용 `PayeePmListPanel`)에 페이지당 50건 페이지네이션을 도입한다.

**Architecture:** `listPayees`/`listPayeesForPm`가 `page` 인자를 받아 `{ rows, page, totalPages }`를 반환하도록 바꾼다. 내부 공용 헬퍼 `fetchMatchedPayees`는 평문/정규화된 평문 필드(`bizName`/`keyId`/`phone`) 검색은 Prisma `where` + `skip`/`take`로 DB 레벨 페이지네이션하고, 암호화된 `bizNumber` 검색만 기존처럼 전체 조회 후 인메모리 복호화·필터링한 뒤 배열을 슬라이스한다. `page.tsx`가 URL의 `page` 쿼리 파라미터를 파싱해 넘기고, 새 공용 컴포넌트 `PayeePager`가 두 패널 하단에 이전/다음+페이지 번호 링크를 렌더링한다. `listPayeesForExport`(엑셀 다운로드)는 페이지네이션과 무관하게 전체 결과를 그대로 반환한다.

**Tech Stack:** Next.js App Router(서버 컴포넌트 + `<form method="get">` 재조회 패턴), Prisma(Postgres), Vitest.

## Global Constraints

- 페이지 크기는 고정 50건(`PAGE_SIZE`), 사용자가 바꾸는 UI 없음.
- 사업자번호(`bizNumber`) 검색의 DB 레벨 인덱싱 개선은 이번 범위 밖 — 전체 스캔+인메모리 필터를 유지한다.
- `listPayeesForExport`의 동작(페이지 무관 전체 다운로드)은 변경하지 않는다.
- role 가드 로직(`listPayees`=ADMIN/SETTLEMENT 전용, `listPayeesForPm`=PM 전용)은 변경하지 않는다.
- 검색 조건(`field`/`q`) 변경 시 `page`는 URL에서 자연히 사라지므로 별도 리셋 로직을 만들지 않는다.
- 스펙 문서: `docs/superpowers/specs/2026-07-30-payee-list-pagination-design.md`

---

### Task 1: `PAGE_SIZE` 상수 + `parsePage` 헬퍼

**Files:**
- Modify: `src/lib/data/payees.ts` (파일 최상단, `PAYEE_SEARCH_FIELDS` 선언부 근처에 추가)
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Produces: `export const PAGE_SIZE = 50;`, `export function parsePage(value: string | undefined): number` — 1 미만이거나 정수가 아니면 1을 반환, 그 외에는 그대로 반환. 이후 모든 태스크가 이 두 값을 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payees.test.ts`의 import 목록에 `parsePage`, `PAGE_SIZE`를 추가하고, 파일 맨 아래(마지막 `it(...)` 다음, `});` 앞)에 아래 테스트를 추가한다.

```ts
import {
  createPayeesBulk, listPayees, listPayeesForExport, listPayeesForPm, findPayeeByBizNumber,
  parsePayeeSearchField, parsePayeePmSearchField, parsePage, PAGE_SIZE,
  updatePayee, updatePayeePmFields, softDeletePayees,
  type PayeeCreateInput,
} from "@/lib/data/payees";
```

```ts
  it("parsePage: 1 미만이거나 숫자가 아니면 1로 클램프", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("3")).toBe(3);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/data-payees.test.ts -t "parsePage"`
Expected: FAIL — `parsePage`/`PAGE_SIZE`가 `@/lib/data/payees`에 존재하지 않아 import 에러 또는 `is not a function`.

- [ ] **Step 3: 최소 구현 추가**

`src/lib/data/payees.ts`의 `export type PayeeSearchFilter = ...` 선언 바로 다음 줄에 추가:

```ts
export const PAGE_SIZE = 50;

// URL 쿼리 파라미터(page)를 파싱. 1 미만이거나 정수가 아니면 1(첫 페이지)로 클램프.
export function parsePage(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/data-payees.test.ts -t "parsePage"`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payees): 페이지네이션용 PAGE_SIZE 상수와 parsePage 헬퍼 추가"
```

---

### Task 2: `fetchMatchedPayees`를 DB 레벨 필터링 + 페이지네이션 지원 구조로 리팩터

**Files:**
- Modify: `src/lib/data/payees.ts:180-245` (`fetchMatchedPayees`, `listPayees`, `listPayeesForExport`)

**Interfaces:**
- Consumes: `PayeeSearchFilter`(Task 이전부터 존재), `RlsContext`, `digitsOnly`/`decrypt`(`@/lib/crypto/payee-secret`, 기존 import).
- Produces: `fetchMatchedPayees(ctx, filter?, pagination?): Promise<{ rows: MatchedPayee[]; totalCount: number }>` — `pagination`은 `{ skip: number; take: number }` 옵션. 이후 태스크(`listPayees`/`listPayeesForPm`/`listPayeesForExport`)가 이 반환 형태에 의존한다. **이 태스크에서는 `listPayees`/`listPayeesForExport`의 공개 반환 타입은 바꾸지 않는다** — 내부 배관만 바꾸고 `rows`만 꺼내 기존과 동일하게 배열을 반환하도록 유지해 기존 테스트가 전부 그대로 통과해야 한다.

이 태스크는 순수 리팩터라 새 테스트를 추가하지 않는다. 기존 `test/data-payees.test.ts` 전체가 회귀 테스트 역할을 한다.

- [ ] **Step 1: 리팩터 전 기존 테스트 전체 통과 확인(베이스라인)**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS (Task 1에서 추가한 `parsePage` 테스트 포함 전체 통과)

- [ ] **Step 2: `fetchMatchedPayees` 구현 교체**

`src/lib/data/payees.ts`에서 아래 블록(현재 180~205행 부근, `type MatchedPayee = ...`부터 `fetchMatchedPayees` 함수 전체)을 다음으로 교체한다.

```ts
type MatchedPayee = Prisma.PayeeGetPayload<{
  include: { attachments: { select: { fileType: true } } };
}>;

type Pagination = { skip: number; take: number };

// listPayees/listPayeesForExport/listPayeesForPm 공통: 조회 + 필터링 + (옵션)페이지네이션.
// bizName/keyId/phone(phoneNormalized)은 평문(또는 정규화된 평문)이라 DB where절로 직접
// 필터링하고 skip/take로 페이지네이션한다. bizNumber는 암호화되어 있어 정확일치 전용
// 블라인드 인덱스로는 부분검색이 불가능하므로, 전체 조회 후 복호화한 값을 인메모리로
// 필터링한 뒤 필요하면 그 결과 배열을 슬라이스한다(이 경로는 페이지네이션 도입 여부와
// 무관하게 항상 전체 스캔 비용이 든다 — 기존 설계 제약, 이번 변경 범위 밖).
// role 가드는 두지 않는다(모듈 내부 전용 함수) — 각 공개 함수가 자기 role을 직접 검증한다.
function fetchMatchedPayees(
  ctx: RlsContext,
  filter?: PayeeSearchFilter,
  pagination?: Pagination,
): Promise<{ rows: MatchedPayee[]; totalCount: number }> {
  return withRLS(ctx, async (tx) => {
    const q = filter?.q.trim();

    if (filter && q && filter.field === "bizNumber") {
      const all = await tx.payee.findMany({
        where: { deletedAt: null },
        orderBy: { keyId: "asc" },
        include: { attachments: { select: { fileType: true } } },
      });
      // 검색어가 URL 쿼리스트링에 그대로 남으므로(GET 폼), 원문 전체 노출 위험을 줄이기 위해
      // 사업자번호 검색은 앞 6자리까지만 사용한다.
      const qDigits = digitsOnly(q).slice(0, 6);
      const filtered = all.filter((r) => digitsOnly(decrypt(r.bizNumberEnc)).includes(qDigits));
      const rows = pagination ? filtered.slice(pagination.skip, pagination.skip + pagination.take) : filtered;
      return { rows, totalCount: filtered.length };
    }

    const where: Prisma.PayeeWhereInput = { deletedAt: null };
    if (filter && q) {
      if (filter.field === "bizName") {
        where.bizName = { contains: q, mode: "insensitive" };
      } else if (filter.field === "keyId") {
        where.keyId = { contains: q, mode: "insensitive" };
      } else if (filter.field === "phone") {
        // 검색어가 URL 쿼리스트링에 그대로 남으므로, 사업자번호 검색과 동일한 이유로 앞 6자리까지만 사용한다.
        const qDigits = digitsOnly(q).slice(0, 6);
        where.phoneNormalized = { contains: qDigits };
      }
    }

    const [rows, totalCount] = await Promise.all([
      tx.payee.findMany({
        where,
        orderBy: { keyId: "asc" },
        include: { attachments: { select: { fileType: true } } },
        ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
      }),
      tx.payee.count({ where }),
    ]);
    return { rows, totalCount };
  });
}
```

- [ ] **Step 3: `listPayees`가 새 반환 형태에서 `rows`만 꺼내 쓰도록 수정(공개 시그니처는 유지)**

`export async function listPayees(...)` 본문의 `const rows = await fetchMatchedPayees(ctx, filter);` 줄을 다음으로 교체:

```ts
  const { rows } = await fetchMatchedPayees(ctx, filter);
```

(함수 시그니처 `export async function listPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeRow[]>`와 이후 `return rows.map(...)`는 이번 스텝에서 그대로 둔다 — Task 3에서 페이지네이션 인자를 추가한다.)

- [ ] **Step 4: `listPayeesForExport`도 동일하게 수정**

`export async function listPayeesForExport(...)` 본문의 `const rows = await fetchMatchedPayees(ctx, filter);` 줄을 다음으로 교체:

```ts
  const { rows } = await fetchMatchedPayees(ctx, filter);
```

- [ ] **Step 5: `listPayeesForPm`도 동일하게 수정**

`export async function listPayeesForPm(...)` 본문의 `const rows = await fetchMatchedPayees(ctx, filter);` 줄을 다음으로 교체:

```ts
  const { rows } = await fetchMatchedPayees(ctx, filter);
```

- [ ] **Step 6: 전체 테스트 통과 확인(회귀 없음)**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS — Step 1의 베이스라인과 동일하게 전부 통과해야 한다(공개 API 동작은 바뀌지 않았으므로).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/data/payees.ts
git commit -m "refactor(payees): fetchMatchedPayees가 DB where절 필터링+페이지네이션 배관을 갖도록 정리"
```

---

### Task 3: `listPayees`/`listPayeesForPm`에 페이지네이션 적용 + 테스트 전면 반영

**Files:**
- Modify: `src/lib/data/payees.ts` (`listPayees`, `listPayeesForPm` 시그니처/반환 타입)
- Modify: `test/data-payees.test.ts` (전체 — 아래 Step 1에서 전체 내용을 교체)

**Interfaces:**
- Consumes: Task 1의 `PAGE_SIZE`, Task 2의 `fetchMatchedPayees(ctx, filter?, pagination?)`.
- Produces: `export type PayeePage<T> = { rows: T[]; page: number; totalPages: number };`, `listPayees(ctx, filter?, page = 1): Promise<PayeePage<PayeeRow>>`, `listPayeesForPm(ctx, filter?, page = 1): Promise<PayeePage<PayeePmRow>>`. Task 4(`page.tsx`)가 이 반환 형태(`.rows`/`.page`/`.totalPages`)를 그대로 사용한다.

**주의:** `listPayees`/`listPayeesForPm`를 호출하는 테스트가 전체 파일에 30곳 넘게 흩어져 있다(검색 테스트뿐 아니라 `updatePayee`/`softDeletePayees`/`createPayeesBulk` 검증에도 조회 결과를 씀). 하나씩 고치면 빠뜨리기 쉬우므로 Step 1에서 파일 전체를 통째로 교체한다.

- [ ] **Step 1: 테스트 파일 전체를 새 반환 형태(`.rows`) + 새 페이지네이션 테스트로 교체(아직 실패함)**

`test/data-payees.test.ts` 파일 전체를 다음 내용으로 교체한다.

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { withRLS } from "@/lib/rls";
import {
  createPayeesBulk, listPayees, listPayeesForExport, listPayeesForPm, findPayeeByBizNumber,
  parsePayeeSearchField, parsePayeePmSearchField, parsePage, PAGE_SIZE,
  updatePayee, updatePayeePmFields, softDeletePayees,
  type PayeeCreateInput,
} from "@/lib/data/payees";
import {
  encrypt, decrypt, blindIndex, maskBizNumber, maskAccountNumber,
} from "@/lib/crypto/payee-secret";

const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.payeeAttachment.deleteMany();
    await tx.payee.deleteMany();
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_instructor" RESTART WITH 1');
    await tx.$executeRawUnsafe('ALTER SEQUENCE "payee_key_seq_vendor" RESTART WITH 1');
  });
}

function input(bizDigits: string, type: "INSTRUCTOR" | "VENDOR", bizName = "이름"): PayeeCreateInput {
  const acct = "110123456789";
  return {
    payeeType: type,
    bizName,
    bizNumberEnc: encrypt(bizDigits),
    bizNumberMasked: maskBizNumber(bizDigits, type),
    bizNumberBidx: blindIndex(bizDigits),
    phone: "010-1234-5678",
    phoneNormalized: "01012345678",
    bankName: "국민",
    accountNumberEnc: encrypt(acct),
    accountNumberMasked: maskAccountNumber(acct),
    accountHolder: "예금주",
    taxType: type === "INSTRUCTOR" ? "BUSINESS_INCOME" : "TAX_INVOICE",
  };
}

// 페이지네이션 테스트용 — 서로 다른 10자리 사업자번호로 count개의 VENDOR row를 만든다.
function manyInputs(count: number): PayeeCreateInput[] {
  return Array.from({ length: count }, (_, i) => input(String(1000000000 + i), "VENDOR", `업체${i}`));
}

describe("payees 데이터 계층", () => {
  beforeEach(reset);

  it("강사=a###, 업체=b### 로 유형별 채번", async () => {
    await createPayeesBulk(ADMIN, [
      input("9001011234567", "INSTRUCTOR"),
      input("1234567890", "VENDOR"),
      input("9002022345678", "INSTRUCTOR"),
    ]);
    const { rows } = await listPayees(ADMIN);
    expect(rows.map((r) => r.keyId).sort()).toEqual(["a001", "a002", "b001"]);
  });

  it("listPayees는 계좌번호 원문만 복호화해 반환(사업자번호 원문은 내보내지 않음)", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const { rows: [row] } = await listPayees(ADMIN);
    expect(row.accountNumber).toBe("110123456789");
    expect(row.hasBizCert).toBe(false);
    expect(row.hasBankbook).toBe(false);
    // 화면은 마스킹만 쓰므로 원문은 반환 타입에 없다. 암호문 자체가 제대로 복호화되는지는 직접 확인.
    expect(Object.keys(row)).not.toContain("bizNumber");
    const [raw] = await withRLS(ADMIN, (tx) => tx.payee.findMany());
    expect(decrypt(raw.bizNumberEnc)).toBe("1234567890");
  });

  it("findPayeeByBizNumber는 블라인드 인덱스로 정확일치(하이픈 무관)", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const found = await findPayeeByBizNumber(ADMIN, "123-45-67890");
    expect(found).toHaveLength(1);
  });

  it("기존 DB·파일 내 중복(bizNumberBidx)은 스킵하고 신규만 등록", async () => {
    const r1 = await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    expect(r1).toEqual({ created: 1, skipped: 0 });

    // 같은 번호(DB중복) + 파일내 중복(9002...×2) + 신규 1건(9003...)
    const r2 = await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR"),      // DB 중복 → skip
      input("9002022345678", "INSTRUCTOR"),
      input("9002022345678", "INSTRUCTOR"), // 파일내 중복 → skip
      input("9003033456789", "INSTRUCTOR"),
    ]);
    expect(r2).toEqual({ created: 2, skipped: 2 });

    const { rows } = await listPayees(ADMIN);
    expect(rows).toHaveLength(3); // b001, a001, a002
  });

  it("listPayees는 마스킹 값을 함께 반환", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const { rows: [row] } = await listPayees(ADMIN);
    expect(row.bizNumberMasked).toBe("123-45-6****");
  });

  it("같은 bizNumberBidx는 DB unique 제약으로 직접 중복 insert가 거부된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    await expect(
      withRLS(ADMIN, (tx) => tx.payee.create({ data: { keyId: "b999", ...input("1234567890", "VENDOR") } })),
    ).rejects.toThrow();
  });

  it("listPayees: 사업자명은 대소문자 무관 부분일치로 검색된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Acme")]);
    const hit = await listPayees(ADMIN, { field: "bizName", q: "acme" });
    expect(hit.rows).toHaveLength(1);
    const miss = await listPayees(ADMIN, { field: "bizName", q: "없는이름" });
    expect(miss.rows).toHaveLength(0);
  });

  it("parsePayeeSearchField: 유효한 값은 그대로, 알 수 없는 값은 undefined 반환", () => {
    expect(parsePayeeSearchField("bizNumber")).toBe("bizNumber");
    expect(parsePayeeSearchField("xyz")).toBeUndefined();
    expect(parsePayeeSearchField(undefined)).toBeUndefined();
  });

  it("listPayees: 고유번호는 부분일치로 검색된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]); // keyId: b001
    const hit = await listPayees(ADMIN, { field: "keyId", q: "b00" });
    expect(hit.rows).toHaveLength(1);
    const miss = await listPayees(ADMIN, { field: "keyId", q: "a99" });
    expect(miss.rows).toHaveLength(0);
  });

  it("listPayees: 사업자번호는 하이픈 유무와 무관하게 부분일치로 검색된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const withHyphen = await listPayees(ADMIN, { field: "bizNumber", q: "123-45" });
    expect(withHyphen.rows).toHaveLength(1);
    const withoutHyphen = await listPayees(ADMIN, { field: "bizNumber", q: "34567890" });
    expect(withoutHyphen.rows).toHaveLength(1);
    const miss = await listPayees(ADMIN, { field: "bizNumber", q: "99999" });
    expect(miss.rows).toHaveLength(0);
  });

  it("listPayees: 검색어가 빈 문자열이면 전체 반환", async () => {
    await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR"),
      input("9002022345678", "INSTRUCTOR"),
    ]);
    const { rows } = await listPayees(ADMIN, { field: "bizName", q: "   " });
    expect(rows).toHaveLength(2);
  });

  it("listPayees: 사업자번호 검색어가 6자리를 넘으면 앞 6자리만 사용해 매칭한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234561111", "VENDOR")]);
    const { rows } = await listPayees(ADMIN, { field: "bizNumber", q: "123456999999" });
    expect(rows).toHaveLength(1);
  });

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

  it("listPayeesForExport는 사업자번호 원문을 포함해 반환한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Acme")]);
    const [row] = await listPayeesForExport(ADMIN);
    expect(row.bizNumber).toBe("1234567890");
    expect(row.accountNumber).toBe("110123456789");
    expect(row.keyId).toBe("b001");
    expect(row.bizName).toBe("Acme");
  });

  it("listPayeesForExport도 listPayees와 동일한 검색 필터를 적용한다", async () => {
    await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR", "Acme"),
      input("9002022345678", "INSTRUCTOR", "다른이름"),
    ]);
    const hit = await listPayeesForExport(ADMIN, { field: "bizName", q: "acme" });
    expect(hit).toHaveLength(1);
    expect(hit[0].bizName).toBe("Acme");
  });

  it("listPayeesForExport는 SETTLEMENT/ADMIN 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    await expect(
      listPayeesForExport({ userId: "pm1", role: "PM" }),
    ).rejects.toThrow("지급 리스트 원문 조회 권한이 없습니다.");
  });

  it("listPayeesForPm: PM 아닌 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    await expect(
      listPayeesForPm(ADMIN),
    ).rejects.toThrow("PM 지급 리스트 조회 권한이 없습니다.");
  });

  it("listPayeesForPm: 연락처는 중간 4자리만, 은행명/계좌번호/예금주는 전체 마스킹해 반환한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Acme")]);
    const PM = { userId: "pm1", role: "PM" as const };
    const { rows: [row] } = await listPayeesForPm(PM);

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
    expect(hit.rows).toHaveLength(1);
    const miss = await listPayeesForPm(PM, { field: "phone", q: "999999" });
    expect(miss.rows).toHaveLength(0);
  });

  it("updatePayee: 이름/은행명/계좌번호/예금주/청구방식을 갱신한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Old Name")]);
    const { rows: [row] } = await listPayees(ADMIN);

    await updatePayee(ADMIN, row.id, {
      bizName: "New Name",
      bankName: "신한은행",
      accountNumber: "999-88-777666",
      accountHolder: "새예금주",
      taxType: "OTHER_INCOME",
    });

    const { rows: [after] } = await listPayees(ADMIN);
    expect(after.bizName).toBe("New Name");
    expect(after.bankName).toBe("신한은행");
    expect(after.accountNumber).toBe("99988777666");
    expect(after.accountHolder).toBe("새예금주");
    expect(after.taxType).toBe("OTHER_INCOME");

    const raw = await withRLS(ADMIN, (tx) => tx.payee.findUnique({ where: { id: row.id } }));
    expect(raw?.accountNumberMasked).toBe("****7666");
  });

  it("updatePayee는 고유번호·유형·사업자번호(마스킹)를 변경하지 않는다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Old Name")]);
    const { rows: [before] } = await listPayees(ADMIN);

    await updatePayee(ADMIN, before.id, {
      bizName: "New Name",
      bankName: "신한은행",
      accountNumber: "1101234567890",
      accountHolder: "새예금주",
      taxType: "OTHER_INCOME",
    });

    const { rows: [after] } = await listPayees(ADMIN);
    expect(after.keyId).toBe(before.keyId);
    expect(after.payeeType).toBe(before.payeeType);
    expect(after.bizNumberMasked).toBe(before.bizNumberMasked);
    expect(after.phone).toBe(before.phone);
  });

  it("updatePayee는 SETTLEMENT/ADMIN 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const { rows: [row] } = await listPayees(ADMIN);

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

  it("updatePayeePmFields: 사업자명/청구방식만 바뀌고 은행명/계좌번호/예금주는 그대로다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Old Name")]);
    const PM = { userId: "pm1", role: "PM" as const };
    const { rows: [row] } = await listPayeesForPm(PM);

    await updatePayeePmFields(PM, row.id, { bizName: "New Name", taxType: "OTHER_INCOME" });

    const { rows: [after] } = await listPayeesForPm(PM);
    expect(after.bizName).toBe("New Name");
    expect(after.taxType).toBe("OTHER_INCOME");
    // 마스킹 값이 그대로인지(=은행명/계좌번호/예금주 원문이 안 바뀌었는지) 확인.
    expect(after.bankNameMasked).toBe(row.bankNameMasked);
    expect(after.accountNumberMasked).toBe(row.accountNumberMasked);
    expect(after.accountHolderMasked).toBe(row.accountHolderMasked);
  });

  it("updatePayeePmFields는 PM 외 역할은 거부한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const { rows: [row] } = await listPayees(ADMIN);
    await expect(
      updatePayeePmFields(ADMIN, row.id, { bizName: "x", taxType: "OTHER_INCOME" }),
    ).rejects.toThrow("PM 지급 리스트 수정 권한이 없습니다.");
  });

  it("listPayees와 listPayeesForExport는 소프트 삭제된 행을 제외한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const { rows: [row] } = await listPayees(ADMIN);

    await withRLS(ADMIN, (tx) =>
      tx.payee.update({ where: { id: row.id }, data: { deletedAt: new Date() } }),
    );

    expect((await listPayees(ADMIN)).rows).toHaveLength(0);
    expect(await listPayeesForExport(ADMIN)).toHaveLength(0);
  });

  it("softDeletePayees: deletedAt을 채우고 listPayees에서 제외한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const { rows: [row] } = await listPayees(ADMIN);

    const res = await softDeletePayees(ADMIN, [row.id]);
    expect(res.ok).toBe(true);

    expect((await listPayees(ADMIN)).rows).toHaveLength(0);
    const raw = await withRLS(ADMIN, (tx) => tx.payee.findUnique({ where: { id: row.id } }));
    expect(raw?.deletedAt).not.toBeNull();
  });

  it("softDeletePayees: 여러 id를 한 번에 삭제한다(일괄 삭제)", async () => {
    await createPayeesBulk(ADMIN, [
      input("1234567890", "VENDOR"),
      input("9002022345678", "INSTRUCTOR"),
    ]);
    const { rows } = await listPayees(ADMIN);

    const res = await softDeletePayees(ADMIN, rows.map((r) => r.id));
    expect(res.ok).toBe(true);
    expect((await listPayees(ADMIN)).rows).toHaveLength(0);
  });

  it("softDeletePayees: 이미 삭제된 항목을 다시 삭제하면 ok:false", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const { rows: [row] } = await listPayees(ADMIN);

    expect((await softDeletePayees(ADMIN, [row.id])).ok).toBe(true);
    const res2 = await softDeletePayees(ADMIN, [row.id]);
    expect(res2.ok).toBe(false);
    expect(res2.error).toBe("삭제할 항목을 찾을 수 없습니다.");
  });

  it("softDeletePayees는 PM도 삭제할 수 있다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const { rows: [row] } = await listPayees(ADMIN);

    const res = await softDeletePayees({ userId: "pm1", role: "PM" }, [row.id]);
    expect(res.ok).toBe(true);
    expect((await listPayees(ADMIN)).rows).toHaveLength(0);
  });

  it("createPayeesBulk: 소프트 삭제된 기존 행과 bizNumberBidx가 같으면 스킵 대신 자동 복원(revive)한다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "Old Name")]);
    const { rows: [before] } = await listPayees(ADMIN);
    await softDeletePayees(ADMIN, [before.id]);

    const r2 = await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR", "New Name")]);
    expect(r2).toEqual({ created: 1, skipped: 0 });

    const { rows } = await listPayees(ADMIN);
    expect(rows).toHaveLength(1); // 새 행이 아니라 기존 행이 갱신됨
    expect(rows[0].id).toBe(before.id);
    expect(rows[0].keyId).toBe(before.keyId); // 새 채번 없이 원래 고유번호 유지
    expect(rows[0].bizName).toBe("New Name");

    const raw = await withRLS(ADMIN, (tx) => tx.payee.findUnique({ where: { id: before.id } }));
    expect(raw?.deletedAt).toBeNull();
  });

  it("parsePage: 1 미만이거나 숫자가 아니면 1로 클램프", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("3")).toBe(3);
  });

  it("listPayees: 기본 페이지 크기만큼 반환하고 totalPages를 계산한다", async () => {
    await createPayeesBulk(ADMIN, manyInputs(PAGE_SIZE + 5));

    const p1 = await listPayees(ADMIN);
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    expect(p1.page).toBe(1);
    expect(p1.totalPages).toBe(2);

    const p2 = await listPayees(ADMIN, undefined, 2);
    expect(p2.rows).toHaveLength(5);
    expect(p2.page).toBe(2);
    expect(p2.totalPages).toBe(2);
  });

  it("listPayees: 사업자번호 검색도 전체 스캔 후 슬라이스로 페이지네이션이 적용된다", async () => {
    await createPayeesBulk(ADMIN, manyInputs(PAGE_SIZE + 5)); // 전부 "100000"으로 시작하는 사업자번호

    const p1 = await listPayees(ADMIN, { field: "bizNumber", q: "100000" });
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    expect(p1.totalPages).toBe(2);

    const p2 = await listPayees(ADMIN, { field: "bizNumber", q: "100000" }, 2);
    expect(p2.rows).toHaveLength(5);
  });

  it("listPayees: page가 totalPages보다 크면 빈 배열을 반환한다(에러 아님)", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const result = await listPayees(ADMIN, undefined, 5);
    expect(result.rows).toHaveLength(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(5);
  });

  it("listPayeesForPm: 기본 페이지 크기만큼 반환하고 totalPages를 계산한다", async () => {
    await createPayeesBulk(ADMIN, manyInputs(PAGE_SIZE + 5));
    const PM = { userId: "pm1", role: "PM" as const };

    const p1 = await listPayeesForPm(PM);
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    expect(p1.totalPages).toBe(2);

    const p2 = await listPayeesForPm(PM, undefined, 2);
    expect(p2.rows).toHaveLength(5);
  });

  it("listPayeesForExport는 페이지 크기를 넘어도 페이지네이션 없이 전체를 반환한다", async () => {
    await createPayeesBulk(ADMIN, manyInputs(PAGE_SIZE + 5));
    const rows = await listPayeesForExport(ADMIN);
    expect(rows).toHaveLength(PAGE_SIZE + 5);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: FAIL — `listPayees`/`listPayeesForPm`가 아직 `{ rows, page, totalPages }`가 아니라 배열을 반환하므로, `rows.map`/`rows.length` 등 배열 전용 호출부에서 타입 에러 또는 런타임 에러(`rows.rows` undefined 등)가 난다. 특히 방금 추가한 페이지네이션 관련 신규 테스트(`기본 페이지 크기만큼 반환...` 등)가 실패해야 한다.

- [ ] **Step 3: `listPayees`에 페이지네이션 적용**

`src/lib/data/payees.ts`에서 `export async function listPayees(...)` 전체를 다음으로 교체:

```ts
export type PayeePage<T> = { rows: T[]; page: number; totalPages: number };

export async function listPayees(ctx: RlsContext, filter?: PayeeSearchFilter, page = 1): Promise<PayeePage<PayeeRow>> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  const skip = (page - 1) * PAGE_SIZE;
  const { rows, totalCount } = await fetchMatchedPayees(ctx, filter, { skip, take: PAGE_SIZE });
  const mapped = rows.map((r) => ({
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
  return { rows: mapped, page, totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) };
}
```

- [ ] **Step 4: `listPayeesForPm`에 페이지네이션 적용**

같은 파일에서 `export async function listPayeesForPm(...)` 전체를 다음으로 교체:

```ts
export async function listPayeesForPm(ctx: RlsContext, filter?: PayeeSearchFilter, page = 1): Promise<PayeePage<PayeePmRow>> {
  if (ctx.role !== "PM") {
    throw new Error("PM 지급 리스트 조회 권한이 없습니다.");
  }
  const skip = (page - 1) * PAGE_SIZE;
  const { rows, totalCount } = await fetchMatchedPayees(ctx, filter, { skip, take: PAGE_SIZE });
  const mapped = rows.map((r) => ({
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
  return { rows: mapped, page, totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: PASS — 전체 테스트(기존 + 신규 페이지네이션 테스트) 통과.

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (이 시점에 `src/app/(app)/expenses/page.tsx`가 아직 옛 배열 반환을 가정하고 있어 타입 에러가 날 수 있다 — Task 4에서 해결하므로, 여기서 `payees.ts`/`data-payees.test.ts` 관련 에러만 없는지 확인하고 `page.tsx` 에러는 Task 4로 넘긴다.)

- [ ] **Step 7: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payees): listPayees/listPayeesForPm에 page 인자와 페이지네이션 반환 추가"
```

---

### Task 4: `page.tsx`에서 `page` 쿼리 파라미터 처리

**Files:**
- Modify: `src/app/(app)/expenses/page.tsx:1-198`

**Interfaces:**
- Consumes: Task 3의 `listPayees(ctx, filter?, page)`/`listPayeesForPm(ctx, filter?, page)`가 반환하는 `{ rows, page, totalPages }`, Task 1의 `parsePage`.
- Produces: `PaymentListTab`이 `PayeeListPanel`/`PayeePmListPanel`에 `page: number`, `totalPages: number` props를 추가로 전달. Task 6/7이 이 두 prop을 받는다.

이 태스크는 서버 컴포넌트 배선 변경이라 별도 단위 테스트가 없다. 타입체크와 수동 확인으로 검증한다.

- [ ] **Step 1: import에 `parsePage` 추가**

`src/app/(app)/expenses/page.tsx` 6번째 줄:

```ts
import { listPayees, listPayeesForPm, parsePayeeSearchField, parsePayeePmSearchField } from "@/lib/data/payees";
```

을 다음으로 교체:

```ts
import { listPayees, listPayeesForPm, parsePage, parsePayeeSearchField, parsePayeePmSearchField } from "@/lib/data/payees";
```

- [ ] **Step 2: `PaymentListTab` 함수 전체 교체**

`src/app/(app)/expenses/page.tsx`의 다음 블록(131~154행 부근):

```tsx
// 지급 리스트 탭 본문 — 공용 원장. ADMIN·SETTLEMENT 전용이라 원문 그대로 표시.
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

을 다음으로 교체:

```tsx
// 지급 리스트 탭 본문 — 공용 원장. ADMIN·SETTLEMENT 전용이라 원문 그대로 표시.
async function PaymentListTab({
  sp,
  user,
}: {
  sp: { field?: string; q?: string; page?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const page = parsePage(sp.page);

  if (user.role === "PM") {
    const parsedField = parsePayeePmSearchField(sp.field);
    const field = parsedField ?? "bizName";
    const q = parsedField ? (sp.q ?? "") : "";
    const result = await listPayeesForPm(ctx, parsedField && q.trim() ? { field: parsedField, q } : undefined, page);
    return <PayeePmListPanel rows={result.rows} field={field} q={q} page={result.page} totalPages={result.totalPages} />;
  }

  const parsedField = parsePayeeSearchField(sp.field);
  const field = parsedField ?? "bizName";
  const q = parsedField ? (sp.q ?? "") : "";
  const result = await listPayees(ctx, parsedField && q.trim() ? { field: parsedField, q } : undefined, page);
  return <PayeeListPanel rows={result.rows} field={field} q={q} page={result.page} totalPages={result.totalPages} />;
}
```

- [ ] **Step 3: `ExpensesPage`의 `searchParams` 타입에 `page` 추가**

`src/app/(app)/expenses/page.tsx`의 `ExpensesPage` 함수 시그니처:

```tsx
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; clientId?: string; from?: string; to?: string; field?: string; q?: string }>;
}) {
```

을 다음으로 교체:

```tsx
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; clientId?: string; from?: string; to?: string; field?: string; q?: string; page?: string }>;
}) {
```

- [ ] **Step 4: 타입체크 (아직 `PayeeListPanel`/`PayeePmListPanel`이 `page`/`totalPages` prop을 안 받으므로 에러 남 — 예상된 상태)**

Run: `npx tsc --noEmit`
Expected: FAIL — `PayeeListPanel`/`PayeePmListPanel`에 `page`/`totalPages` prop이 없다는 타입 에러. Task 6/7에서 해결되므로 지금은 이 에러만 있는지 확인하고 넘어간다.

- [ ] **Step 5: 커밋**

```bash
git add src/app/\(app\)/expenses/page.tsx
git commit -m "feat(payees): 지급 리스트 탭에서 page 쿼리 파라미터를 파싱해 전달"
```

---

### Task 5: `PayeePager` 공용 컴포넌트 생성

**Files:**
- Create: `src/app/(app)/expenses/PayeePager.tsx`

**Interfaces:**
- Produces: `export function PayeePager({ page, totalPages, field, q }: { page: number; totalPages: number; field: string; q: string })` — Task 6/7이 이 컴포넌트를 import해서 쓴다.

순수 렌더링 컴포넌트라 자동화 단위 테스트는 두지 않고(이 코드베이스는 React 컴포넌트에 대한 단위 테스트 관례가 없다 — 다른 `*Panel.tsx`/`*Row.tsx`도 테스트 파일이 없음), Task 8의 수동 확인으로 검증한다.

- [ ] **Step 1: 컴포넌트 작성**

`src/app/(app)/expenses/PayeePager.tsx` 파일을 새로 만든다:

```tsx
import Link from "next/link";

function pageHref(field: string, q: string, page: number): string {
  const params = new URLSearchParams({ tab: "payment-list", field, q, page: String(page) });
  return `/expenses?${params.toString()}`;
}

// 이전/다음 + 현재 페이지 주변 최대 7개 번호 링크. totalPages가 1 이하면 아무것도 렌더링하지 않는다.
function pageWindow(page: number, totalPages: number): number[] {
  const windowSize = 7;
  let start = Math.max(1, page - 3);
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return pages;
}

export function PayeePager({
  page,
  totalPages,
  field,
  q,
}: {
  page: number;
  totalPages: number;
  field: string;
  q: string;
}) {
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);
  const linkClass = "rounded border border-[var(--color-border)] px-3 py-1.5 text-sm";
  const disabledClass = "cursor-not-allowed rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] opacity-50";
  const currentClass = "rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white";

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-center gap-1">
      {page > 1 ? (
        <Link href={pageHref(field, q, page - 1)} className={linkClass}>이전</Link>
      ) : (
        <span className={disabledClass}>이전</span>
      )}
      {pages.map((p) =>
        p === page ? (
          <span key={p} className={currentClass}>{p}</span>
        ) : (
          <Link key={p} href={pageHref(field, q, p)} className={linkClass}>{p}</Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={pageHref(field, q, page + 1)} className={linkClass}>다음</Link>
      ) : (
        <span className={disabledClass}>다음</span>
      )}
    </nav>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: `PayeePager.tsx` 자체에는 에러 없음(기존 `PayeeListPanel`/`PayeePmListPanel` 관련 에러는 Task 4와 동일하게 아직 남아있음 — 정상).

- [ ] **Step 3: 커밋**

```bash
git add src/app/\(app\)/expenses/PayeePager.tsx
git commit -m "feat(payees): 이전/다음+페이지 번호 링크를 렌더링하는 PayeePager 컴포넌트 추가"
```

---

### Task 6: `PayeeListPanel`에 `PayeePager` 연결

**Files:**
- Modify: `src/app/(app)/expenses/PayeeListPanel.tsx`

**Interfaces:**
- Consumes: Task 5의 `PayeePager`, Task 4가 전달하는 `page`/`totalPages` props.

- [ ] **Step 1: import 추가**

`src/app/(app)/expenses/PayeeListPanel.tsx` 상단 import 목록(현재 4~10행)에 아래 줄 추가:

```ts
import { PayeePager } from "./PayeePager";
```

- [ ] **Step 2: props 타입/구조분해에 `page`/`totalPages` 추가**

다음 블록:

```tsx
export function PayeeListPanel({
  rows,
  field,
  q,
}: {
  rows: PayeeRowData[];
  field: PayeeSearchField;
  q: string;
}) {
```

을 다음으로 교체:

```tsx
export function PayeeListPanel({
  rows,
  field,
  q,
  page,
  totalPages,
}: {
  rows: PayeeRowData[];
  field: PayeeSearchField;
  q: string;
  page: number;
  totalPages: number;
}) {
```

- [ ] **Step 3: 테이블 아래에 `PayeePager` 렌더링**

다음 블록(테이블을 감싸는 `overflow-x-auto` div 바로 다음, `{rows.length === 0 && (...)}` 바로 앞):

```tsx
      </div>

      {rows.length === 0 && (
```

을 다음으로 교체:

```tsx
      </div>

      <PayeePager page={page} totalPages={totalPages} field={field} q={q} />

      {rows.length === 0 && (
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: `PayeeListPanel` 관련 에러 사라짐. (Task 7 전까지 `PayeePmListPanel` 관련 에러는 남아있을 수 있음 — 정상.)

- [ ] **Step 5: 커밋**

```bash
git add src/app/\(app\)/expenses/PayeeListPanel.tsx
git commit -m "feat(payees): PayeeListPanel 하단에 페이지네이션 UI 연결"
```

---

### Task 7: `PayeePmListPanel`에 `PayeePager` 연결

**Files:**
- Modify: `src/app/(app)/expenses/PayeePmListPanel.tsx`

**Interfaces:**
- Consumes: Task 5의 `PayeePager`, Task 4가 전달하는 `page`/`totalPages` props.

- [ ] **Step 1: import 추가**

`src/app/(app)/expenses/PayeePmListPanel.tsx` 상단 import 목록(현재 4~10행)에 아래 줄 추가:

```ts
import { PayeePager } from "./PayeePager";
```

- [ ] **Step 2: props 타입/구조분해에 `page`/`totalPages` 추가**

다음 블록:

```tsx
export function PayeePmListPanel({
  rows,
  field,
  q,
}: {
  rows: PayeePmRowData[];
  field: PayeePmSearchField;
  q: string;
}) {
```

을 다음으로 교체:

```tsx
export function PayeePmListPanel({
  rows,
  field,
  q,
  page,
  totalPages,
}: {
  rows: PayeePmRowData[];
  field: PayeePmSearchField;
  q: string;
  page: number;
  totalPages: number;
}) {
```

- [ ] **Step 3: 테이블 아래에 `PayeePager` 렌더링**

다음 블록(테이블을 감싸는 `overflow-x-auto` div 바로 다음, `{rows.length === 0 && (...)}` 바로 앞):

```tsx
      </div>

      {rows.length === 0 && (
```

을 다음으로 교체:

```tsx
      </div>

      <PayeePager page={page} totalPages={totalPages} field={field} q={q} />

      {rows.length === 0 && (
```

- [ ] **Step 4: 타입체크(전체 통과 확인)**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: 전체 테스트 통과 확인**

Run: `npx vitest run`
Expected: PASS (전체 테스트 스위트, `test/data-payees.test.ts` 포함)

- [ ] **Step 6: 커밋**

```bash
git add src/app/\(app\)/expenses/PayeePmListPanel.tsx
git commit -m "feat(payees): PayeePmListPanel 하단에 페이지네이션 UI 연결"
```

---

### Task 8: 수동 검증

**Files:** 없음(코드 변경 없음, 개발 서버로 실제 동작 확인)

- [ ] **Step 1: 개발 서버 실행**

Run: `npm run dev`

- [ ] **Step 2: ADMIN/SETTLEMENT 화면 확인**

`/expenses?tab=payment-list`로 접속(ADMIN 또는 SETTLEMENT 계정) 후 확인:
- 지급 대상이 50건을 넘도록 데이터가 있다면(없으면 엑셀 업로드로 50건 이상 등록), 1페이지에 50건만 보이고 하단에 이전/다음+페이지 번호가 뜨는지.
- 페이지 번호 클릭 시 다음 50건이 보이고 URL에 `&page=2`가 붙는지.
- 1페이지에서 "이전" 버튼이 비활성화되는지, 마지막 페이지에서 "다음" 버튼이 비활성화되는지.
- 검색(사업자명/사업자번호/고유번호)으로 조회하면 결과가 필터링되고 `page`가 1로 초기화되는지(주소창에 `page` 파라미터가 사라지는지).
- 체크박스로 일부 선택 후 엑셁 다운로드 시 선택한 항목만 받아지는지, 선택 없이 다운로드 시 현재 검색 조건의 **전체** 결과(페이지 무관, 50건 넘는 항목 포함)를 받는지.

- [ ] **Step 3: PM 화면 확인**

PM 계정으로 `/expenses?tab=payment-list` 접속 후 동일하게 페이지네이션 동작, 연락처/사업자명/고유번호 검색+페이지 이동을 확인한다.

- [ ] **Step 4: 회귀 확인**

`/expenses?tab=payment-list`에서 인라인 수정(연필 아이콘), 개별/일괄 삭제, 첨부파일 업로드/조회가 페이지네이션 도입 후에도 정상 동작하는지 확인한다(현재 페이지에 보이는 행 기준으로 동작하면 정상).
