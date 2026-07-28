# 지급 리스트 검색 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지급 리스트 화면(`/expenses?tab=payment-list`)의 검색 UI(필드 선택 + 검색어 입력 + 조회 버튼)에 실제 조회 로직을 연결한다.

**Architecture:** GET 쿼리 파라미터(`field`, `q`) 기반으로 서버 컴포넌트가 재조회하는 방식(기존 "전체 내역" 탭과 동일 패턴). 데이터 계층(`listPayees`)이 필터를 받아 서버에서 매칭 후, 마스킹된 값만 클라이언트로 내려준다. 사업자번호 검색은 매 요청 시 대상 row만 복호화해 하이픈 무관 부분일치를 확인한다.

**Tech Stack:** Next.js App Router (서버 컴포넌트 + GET form), Prisma/PostgreSQL, vitest.

## Global Constraints

- 검색어 입력창 placeholder는 정확히 "검색어 입력 (하이픈 제외 가능)" 유지 (스펙 요구사항, 기존 마크업에 이미 존재 — 변경 금지).
- `listPayees` 앞단의 `ADMIN`/`SETTLEMENT` role 체크 로직은 변경하지 않는다.
- 페이지네이션은 도입하지 않는다(기존에도 없음).
- `PayeeRow`(클라이언트 전달 타입)에는 사업자번호 원문이나 블라인드 인덱스를 절대 추가하지 않는다 — 마스킹된 값만 유지.

---

## File Structure

- Modify: `src/lib/data/payees.ts` — `PayeeSearchField`/`PAYEE_SEARCH_FIELDS`/`PayeeSearchFilter` 타입 추가, `listPayees`에 필터링 로직 추가.
- Modify: `src/app/(app)/expenses/page.tsx` — `searchParams`에 `field`/`q` 추가, 파싱해서 `listPayees`·`PayeeListPanel`에 전달.
- Modify: `src/app/(app)/expenses/PayeeListPanel.tsx` — 검색 영역을 `<form method="get">`로 전환, `field`/`q` props로 검색 상태 유지, 0건 메시지 분기.
- Modify: `test/data-payees.test.ts` — 필터링 케이스 추가.

---

### Task 1: `listPayees` 검색 필터링 로직 (데이터 계층)

**Files:**
- Modify: `src/lib/data/payees.ts:1-3` (import 및 타입 export 추가), `src/lib/data/payees.ts:112-136` (`listPayees` 함수)
- Test: `test/data-payees.test.ts`

**Interfaces:**
- Consumes: 기존 `withRLS`, `decrypt`, `digitsOnly`(이미 `payees.ts`에 import돼 있음), `RlsContext`, `PayeeRow`
- Produces:
  - `export const PAYEE_SEARCH_FIELDS = ["bizName", "bizNumber", "keyId"] as const;`
  - `export type PayeeSearchField = (typeof PAYEE_SEARCH_FIELDS)[number];`
  - `export type PayeeSearchFilter = { field: PayeeSearchField; q: string };`
  - `export function listPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeRow[]>` — 이후 Task에서 이 시그니처를 그대로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payees.test.ts`의 기존 `describe("payees 데이터 계층", ...)` 블록 안, 마지막 `it(...)` 다음에 추가:

```ts
  it("listPayees: 사업자명은 대소문자 무관 부분일치로 검색된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]); // bizName: "이름"
    const hit = await listPayees(ADMIN, { field: "bizName", q: "이름" });
    expect(hit).toHaveLength(1);
    const miss = await listPayees(ADMIN, { field: "bizName", q: "없는이름" });
    expect(miss).toHaveLength(0);
  });

  it("listPayees: 고유번호는 부분일치로 검색된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]); // keyId: b001
    const hit = await listPayees(ADMIN, { field: "keyId", q: "b00" });
    expect(hit).toHaveLength(1);
    const miss = await listPayees(ADMIN, { field: "keyId", q: "a99" });
    expect(miss).toHaveLength(0);
  });

  it("listPayees: 사업자번호는 하이픈 유무와 무관하게 부분일치로 검색된다", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const withHyphen = await listPayees(ADMIN, { field: "bizNumber", q: "123-45" });
    expect(withHyphen).toHaveLength(1);
    const withoutHyphen = await listPayees(ADMIN, { field: "bizNumber", q: "34567890" });
    expect(withoutHyphen).toHaveLength(1);
    const miss = await listPayees(ADMIN, { field: "bizNumber", q: "99999" });
    expect(miss).toHaveLength(0);
  });

  it("listPayees: 검색어가 빈 문자열이면 전체 반환", async () => {
    await createPayeesBulk(ADMIN, [input("1234567890", "VENDOR")]);
    const rows = await listPayees(ADMIN, { field: "bizName", q: "   " });
    expect(rows).toHaveLength(1);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: 새로 추가한 4개 테스트가 FAIL (`listPayees`가 두 번째 인자를 받지 않아 타입 에러 또는 필터 미적용으로 실패)

- [ ] **Step 3: 최소 구현 작성**

`src/lib/data/payees.ts` 상단 (기존 `PayeeCreateInput` 타입 위, import 문 바로 아래)에 추가:

```ts
export const PAYEE_SEARCH_FIELDS = ["bizName", "bizNumber", "keyId"] as const;
export type PayeeSearchField = (typeof PAYEE_SEARCH_FIELDS)[number];
export type PayeeSearchFilter = { field: PayeeSearchField; q: string };
```

기존 `listPayees` 함수(112~136행) 전체를 다음으로 교체:

```ts
export function listPayees(ctx: RlsContext, filter?: PayeeSearchFilter): Promise<PayeeRow[]> {
  if (ctx.role !== "ADMIN" && ctx.role !== "SETTLEMENT") {
    throw new Error("지급 리스트 원문 조회 권한이 없습니다.");
  }
  return withRLS(ctx, async (tx) => {
    const rows = await tx.payee.findMany({
      orderBy: { keyId: "asc" },
      include: { attachments: { select: { fileType: true } } },
    });
    const q = filter?.q.trim();
    const matched = !filter || !q
      ? rows
      : rows.filter((r) => {
          if (filter.field === "bizName") return r.bizName.toLowerCase().includes(q.toLowerCase());
          if (filter.field === "keyId") return r.keyId.toLowerCase().includes(q.toLowerCase());
          return digitsOnly(decrypt(r.bizNumberEnc)).includes(digitsOnly(q));
        });
    return matched.map((r) => ({
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
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/data-payees.test.ts`
Expected: 전체 PASS (기존 케이스 포함)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/payees.ts test/data-payees.test.ts
git commit -m "feat(payees): listPayees에 검색 필터링 추가"
```

---

### Task 2: 페이지 라우팅 — searchParams 파싱 및 전달

**Files:**
- Modify: `src/app/(app)/expenses/page.tsx`

**Interfaces:**
- Consumes: Task 1의 `listPayees(ctx, filter?)`, `PAYEE_SEARCH_FIELDS`, `PayeeSearchField`
- Produces: `PayeeListPanel`이 받을 `field: PayeeSearchField`, `q: string` props (Task 3에서 소비)

이 태스크는 라우팅 파싱 로직이라 별도 유닛 테스트 없이 타입 체크 + 수동 확인으로 검증한다(프로젝트에 페이지 컴포넌트용 테스트 인프라 없음, 기존 관례와 동일).

- [ ] **Step 1: import 및 searchParams 타입 수정**

`src/app/(app)/expenses/page.tsx` 6행:

```ts
import { listPayees, PAYEE_SEARCH_FIELDS, type PayeeSearchField } from "@/lib/data/payees";
```

79~83행(`ExpensesPage`의 `searchParams` prop 타입)을 다음으로 교체:

```ts
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; clientId?: string; year?: string; month?: string; field?: string; q?: string }>;
}) {
```

- [ ] **Step 2: `parsePayeeSearchField` 헬퍼 추가**

`page.tsx`에서 `PaymentListTab` 함수(72행) 바로 위에 추가:

```ts
// 알 수 없는 field 값(URL 조작 등)은 기본값으로 대체 — 별도 에러 UI 없음.
function parsePayeeSearchField(value: string | undefined): PayeeSearchField {
  const found = PAYEE_SEARCH_FIELDS.find((f) => f === value);
  return found ?? "bizName";
}
```

- [ ] **Step 3: `PaymentListTab`이 `sp`를 받아 필터를 구성하도록 수정**

기존 72~77행을 다음으로 교체:

```ts
// 지급 리스트 탭 본문 — 공용 원장. ADMIN·SETTLEMENT 전용이라 원문 그대로 표시.
async function PaymentListTab({
  sp,
  user,
}: {
  sp: { field?: string; q?: string };
  user: SessionUser;
}) {
  const ctx = getRlsContext(user);
  const field = parsePayeeSearchField(sp.field);
  const q = sp.q ?? "";
  const rows = await listPayees(ctx, q.trim() ? { field, q } : undefined);
  return <PayeeListPanel rows={rows} field={field} q={q} />;
}
```

- [ ] **Step 4: 호출부 수정**

100~104행(`currentTab === "all" ? ... : ...`)을 다음으로 교체:

```tsx
      {currentTab === "all" ? (
        <AllExpensesTab sp={sp} user={user} />
      ) : (
        <PaymentListTab sp={sp} user={user} />
      )}
```

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: `PayeeListPanel`이 아직 `field`/`q` props를 받지 않아 에러 발생(Task 3에서 해소). 이 시점엔 `PayeeListPanel` 관련 타입 에러만 있어야 하고, 그 외 에러는 없어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add "src/app/(app)/expenses/page.tsx"
git commit -m "feat(payees): 지급리스트 검색 쿼리파라미터 파싱 연결"
```

---

### Task 3: `PayeeListPanel` — 검색 폼 UI 및 0건 메시지 분기

**Files:**
- Modify: `src/app/(app)/expenses/PayeeListPanel.tsx`

**Interfaces:**
- Consumes: Task 2에서 전달되는 `field: PayeeSearchField`, `q: string` props; `PayeeSearchField` 타입(from `@/lib/data/payees`)
- Produces: 없음(최종 UI)

- [ ] **Step 1: import 및 `SEARCH_FIELD_OPTIONS` 교체**

`PayeeListPanel.tsx` 1~10행 중 다음 두 줄:

```ts
import type { PayeeRow } from "@/lib/data/payees";
import { PayeeUploadModal } from "./PayeeUploadModal";

// 검색 드롭다운 옵션(다음 단계에서 검색 로직 연결).
const SEARCH_FIELDS = ["사업자명(이름)", "사업자번호", "고유번호"] as const;
```

를 다음으로 교체:

```ts
import type { PayeeRow, PayeeSearchField } from "@/lib/data/payees";
import { PayeeUploadModal } from "./PayeeUploadModal";

const SEARCH_FIELD_OPTIONS: { value: PayeeSearchField; label: string }[] = [
  { value: "bizName", label: "사업자명(이름)" },
  { value: "bizNumber", label: "사업자번호" },
  { value: "keyId", label: "고유번호" },
];
```

- [ ] **Step 2: 컴포넌트 props 확장**

53행 `export function PayeeListPanel({ rows }: { rows: PayeeRow[] }) {` 를:

```ts
export function PayeeListPanel({
  rows,
  field,
  q,
}: {
  rows: PayeeRow[];
  field: PayeeSearchField;
  q: string;
}) {
```

- [ ] **Step 3: 검색 영역을 GET form으로 교체**

87~119행의 상단 바 블록 중 검색 부분(90~106행)을 다음으로 교체:

```tsx
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="payment-list" />
          <span className="text-sm text-[var(--color-muted)]">검색:</span>
          <select
            name="field"
            defaultValue={field}
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
            placeholder="검색어 입력 (하이픈 제외 가능)"
            className="w-64 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">
            🔍 조회
          </button>
        </form>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            📗 엑셀 다운로드
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
```

(우측 액션 버튼 블록은 기존과 동일 — 변경 없음, 전체 블록을 그대로 옮겨 적은 것.)

- [ ] **Step 4: 0건 메시지 분기**

기존 233~235행:

```tsx
      {rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">등록된 지급 대상이 없습니다.</p>
      )}
```

를 다음으로 교체:

```tsx
      {rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
          {q.trim() ? "검색 결과가 없습니다." : "등록된 지급 대상이 없습니다."}
        </p>
      )}
```

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (Task 2에서 남아있던 `PayeeListPanel` props 타입 에러 해소)

- [ ] **Step 6: 전체 테스트 재실행**

Run: `npx vitest run`
Expected: 전체 PASS (회귀 없음)

- [ ] **Step 7: 수동 검증 (개발 서버)**

```bash
npm run dev
```

브라우저에서 `/expenses?tab=payment-list` 접속 후:
1. 사업자명으로 일부 글자만 검색 → 해당 행만 표시되는지 확인
2. 고유번호로 일부만 검색 → 해당 행만 표시되는지 확인
3. 사업자번호를 하이픈 포함/제외 두 형태로 각각 검색 → 동일한 행이 매칭되는지 확인
4. 검색어를 비운 채 조회 → 전체 목록 표시 확인
5. 존재하지 않는 검색어로 조회 → "검색 결과가 없습니다." 문구 확인

- [ ] **Step 8: 커밋**

```bash
git add "src/app/(app)/expenses/PayeeListPanel.tsx"
git commit -m "feat(payees): 지급리스트 검색 폼 UI 연결"
```

---

## Self-Review 결과

- **스펙 커버리지**: 하이픈 무관 매칭(Task 1), 조회 버튼 클릭 시 필터링(Task 2·3, GET form), placeholder 문구 유지(Global Constraints, Task 3), 역할별 검색 범위 차등 없음(설계 결론, 코드 변경 없음으로 반영) — 모두 태스크에 매핑됨.
- **플레이스홀더 스캔**: 없음 — 모든 스텝에 실제 코드 포함.
- **타입 일관성**: `PayeeSearchField`/`PayeeSearchFilter`(Task 1 정의) → `page.tsx`(Task 2에서 그대로 사용) → `PayeeListPanel`(Task 3에서 `PayeeSearchField`만 사용) 간 이름·형태 일치 확인.
