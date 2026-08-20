# 비활성 계정 하드 삭제 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비활성화(`status = INACTIVE`)된 사용자 계정을 최고관리자가 DB에서 완전히 제거(하드 삭제)할 수 있게 한다.

**Architecture:** 사용자 하드 삭제 시 연관 레코드 정리를 DB FK 제약에 위임한다. `PaymentRequest.requester` 관계만 `RESTRICT` → `SET NULL`(+ nullable)로 바꿔 재무 이력을 보존하고, 나머지 관계(ClientManager/ProjectManager/Account/Session = Cascade, Team = SetNull)는 기존 제약을 그대로 활용한다. 서버 액션은 기존 `applyStatus`/`changeStatus` 패턴을 미러링하며, `where`에 `status: "INACTIVE"` 가드를 넣어 활성 계정 삭제를 쿼리 레벨에서 차단한다.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 6 + PostgreSQL(Supabase, RLS), Vitest, TypeScript.

## Global Constraints

- 마이그레이션은 **직접 작성**해 `npx prisma migrate deploy`로 적용한다. `roi_app` 역할에 CREATEDB 권한이 없어 `migrate dev`/shadow DB가 실패한다.
- `prisma generate`는 **개발 서버를 중단한 뒤** 실행한다(Windows에서 실행 중이면 파일 잠금으로 실패).
- 하드 삭제 권한은 `SUPER_ADMIN` 전용(`requireRole("SUPER_ADMIN")`).
- 하드 삭제는 `status === "INACTIVE"`인 계정에만 허용한다.
- 기존 코드 스타일(한국어 주석, 기존 함수 시그니처·네이밍)을 따른다. 요청 범위 밖 리팩터링 금지.
- RLS/GRANT 추가 마이그레이션은 **불필요**하다(검증 완료): `User` 정책 `auth_user_app`이 `FOR ALL TO roi_app`이고, `roi_app`은 이미 모든 테이블에 `DELETE` 권한 보유. 자식 테이블의 Cascade/SetNull은 FK 액션이라 RLS를 우회한다.

---

### Task 1: 스키마 마이그레이션 — PaymentRequest.requester를 nullable + SET NULL로 전환

**Files:**
- Modify: `prisma/schema.prisma:348-349`
- Create: `prisma/migrations/20260820000000_payment_request_requester_nullable/migration.sql`

**Interfaces:**
- Produces: 하드 삭제 시 `User` 삭제가 DB FK 레벨에서 성공하도록 만든다(지급요청은 `requesterId = NULL`로 보존). Prisma 타입상 `PaymentRequest.requesterId`가 `string | null`, `requester`가 `User | null`이 된다.

- [ ] **Step 1: 스키마 수정**

`prisma/schema.prisma`의 `PaymentRequest` 모델에서 아래 두 줄(현재 348-349행)을 수정한다.

변경 전:
```prisma
  requesterId   String                                   // 신청인
  requester     User                  @relation(fields: [requesterId], references: [id])
```
변경 후:
```prisma
  requesterId   String?                                  // 신청인. 신청인 계정 하드 삭제 시 NULL(레코드는 보존).
  requester     User?                 @relation(fields: [requesterId], references: [id], onDelete: SetNull)
```

- [ ] **Step 2: 마이그레이션 SQL 작성**

`prisma/migrations/20260820000000_payment_request_requester_nullable/migration.sql` 파일을 생성한다.

```sql
-- PaymentRequest.requester를 선택적으로 전환한다.
-- 신청인(User) 하드 삭제 시 지급요청 레코드(재무 이력)는 보존하되 requesterId만 NULL로 만든다.
-- 기존 FK는 ON DELETE RESTRICT였다 → ON DELETE SET NULL로 재생성.

ALTER TABLE "PaymentRequest" ALTER COLUMN "requesterId" DROP NOT NULL;

ALTER TABLE "PaymentRequest" DROP CONSTRAINT "PaymentRequest_requesterId_fkey";

ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: 마이그레이션 적용**

Run: `npx prisma migrate deploy`
Expected: `Applying migration \`20260820000000_payment_request_requester_nullable\`` 후 `All migrations have been successfully applied.`

- [ ] **Step 4: Prisma 클라이언트 재생성 (개발 서버 중단 상태에서)**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` 성공 메시지. 실패 시 `next dev`가 실행 중이 아닌지 확인.

- [ ] **Step 5: 기존 테스트가 여전히 통과하는지 확인**

Run: `npm test`
Expected: 전체 통과. (이 시점엔 payment-requests.ts가 아직 null을 처리하지 않지만, 기존 데이터엔 requester가 모두 있으므로 런타임 테스트는 통과. 타입 오류는 Task 2에서 해소한다.)

- [ ] **Step 6: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations/20260820000000_payment_request_requester_nullable
git commit -m "feat: PaymentRequest.requester nullable + ON DELETE SET NULL"
```

---

### Task 2: null 신청인 처리 — payment-requests.ts

**Files:**
- Modify: `src/lib/data/payment-requests.ts:52` (행 타입), `:124` 및 `:192` (신청인명 매핑)
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Consumes: Task 1의 nullable `requester` 관계.
- Produces: `PaymentRequestRow.requesterId: string | null`. 삭제된 신청인의 요청은 `requesterName === "(삭제된 사용자)"`로 표시된다. `row.requesterId === currentUserId`(PM 편집 권한 판정)는 null과 비교되어 자연히 false → 편집 대상에서 제외.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data-payment-requests.test.ts`의 최상위 `describe` 안(예: 파일 끝 `describe` 블록 뒤)에 아래 테스트를 추가한다. 파일 상단에서 이미 import된 `seed`, `createPayee`, `createPaymentRequestsBulk`, `baseInput`, `listPaymentRequests`, `prisma`, `ADMIN`을 사용한다.

```ts
describe("listPaymentRequests — 삭제된 신청인", () => {
  it("신청인 계정이 하드 삭제되면 requesterId=null, 이름은 (삭제된 사용자)", async () => {
    const { pmA, clientA } = await seed();
    const payee = await createPayee("1112233445", "삭제테스트업체");
    const created = await createPaymentRequestsBulk({ userId: pmA.id, role: "PM" }, pmA.id, [
      baseInput({ requesterId: pmA.id, clientId: clientA.id, payeeId: payee.id }),
    ]);
    expect(created.ok).toBe(true);

    // 신청인(PM) 하드 삭제 — FK SET NULL로 지급요청은 보존되어야 한다.
    await prisma.user.delete({ where: { id: pmA.id } });

    const { rows } = await listPaymentRequests(ADMIN);
    expect(rows).toHaveLength(1);
    expect(rows[0].requesterId).toBeNull();
    expect(rows[0].requesterName).toBe("(삭제된 사용자)");
  });
});
```

> 참고: `baseInput`은 `payeeId`도 받는다. 기존 테스트의 `baseInput({...})` 호출부(파일 내 319행 부근)를 참고해 필수 필드가 채워지는지 확인하고, 시그니처가 `payeeId`를 포함하지 않으면 기존 호출과 동일한 형태로 맞춘다.

- [ ] **Step 2: 테스트 실행 — 타입 오류 또는 실패 확인**

Run: `npm test -- data-payment-requests`
Expected: 컴파일 타입 오류(`r.requester` 는 null일 수 있음 / `requesterId` 타입 불일치) 또는 `requesterName`이 `null ?? undefined` 관련으로 실패.

- [ ] **Step 3: 행 타입을 nullable로 수정**

`src/lib/data/payment-requests.ts`의 `PaymentRequestRow` 타입(52행)을 수정한다.

변경 전:
```ts
  requesterId: string;
```
변경 후:
```ts
  requesterId: string | null;
```

- [ ] **Step 4: 신청인명 매핑 2곳에 null 폴백 추가**

`listPaymentRequests`의 매핑(124행 부근):

변경 전:
```ts
    requesterName: r.requester.name ?? r.requester.email,
```
변경 후:
```ts
    requesterName: r.requester?.name ?? r.requester?.email ?? "(삭제된 사용자)",
```

`listPaymentRequestsForExport`의 매핑(192행 부근)도 **동일하게** 수정한다.

변경 전:
```ts
    requesterName: r.requester.name ?? r.requester.email,
```
변경 후:
```ts
    requesterName: r.requester?.name ?? r.requester?.email ?? "(삭제된 사용자)",
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -- data-payment-requests`
Expected: 신규 테스트 포함 전체 PASS.

- [ ] **Step 6: 전체 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음. (`row.requesterId === currentUserId` 비교부는 `string | null === string`이라 타입상 유효 — 클라이언트 컴포넌트 수정 불필요.)

- [ ] **Step 7: 커밋**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat: 지급요청 목록에서 삭제된 신청인을 (삭제된 사용자)로 표시"
```

---

### Task 3: 하드 삭제 코어 + 서버 액션 — admin/users/actions.ts

**Files:**
- Modify: `src/app/(app)/admin/users/actions.ts`
- Test: `test/user-admin-actions.test.ts`

**Interfaces:**
- Consumes: Task 1의 FK SET NULL/Cascade.
- Produces:
  - `applyHardDelete(input: { userId: string }): Promise<{ ok: boolean; error?: string }>` — `status: "INACTIVE"`인 사용자만 삭제. 대상 없음/비INACTIVE면 `{ ok: false, error }`.
  - `hardDeleteUser(formData: FormData): Promise<void>` — `SUPER_ADMIN` 전용 폼 액션. `formData`의 `userId`를 읽어 `applyHardDelete` 호출 후 `revalidatePath("/admin/users")`.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/user-admin-actions.test.ts`에 아래를 추가한다. 상단 import에 `applyHardDelete`를 더한다.

import 수정:
```ts
import { applyApproval, applyStatus, applyHardDelete } from "@/app/(app)/admin/users/actions";
```

테스트 추가(파일 끝):
```ts
describe("applyHardDelete", () => {
  it("INACTIVE 사용자를 삭제한다", async () => {
    const u = await prisma.user.create({ data: { email: "del@huno.kr", role: "PM", status: "INACTIVE" } });
    const res = await applyHardDelete({ userId: u.id });
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after).toBeNull();
  });

  it("ACTIVE 사용자는 삭제하지 않는다", async () => {
    const u = await prisma.user.create({ data: { email: "keep@huno.kr", role: "PM", status: "ACTIVE" } });
    const res = await applyHardDelete({ userId: u.id });
    expect(res.ok).toBe(false);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after).not.toBeNull();
  });

  it("존재하지 않는 사용자는 error", async () => {
    const res = await applyHardDelete({ userId: "nope" });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm test -- user-admin-actions`
Expected: FAIL — `applyHardDelete is not a function` / import 해석 실패.

- [ ] **Step 3: 코어 + 액션 구현**

`src/app/(app)/admin/users/actions.ts`의 `applyStatus` 함수 바로 뒤에 코어를 추가한다.

```ts
export async function applyHardDelete(input: {
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  // 비활성(INACTIVE) 계정만 완전 삭제한다. 활성/대기 계정은 쿼리 레벨에서 차단.
  // 담당 배정·OAuth 계정·세션은 FK Cascade로, 지급요청은 FK SET NULL로 자동 정리된다.
  const result = await prisma.user.deleteMany({
    where: { id: input.userId, status: "INACTIVE" },
  });
  if (result.count === 0) return { ok: false, error: "비활성 사용자를 찾을 수 없습니다." };
  return { ok: true };
}
```

그리고 `changeStatus` 함수 바로 뒤에 폼 액션을 추가한다.

```ts
export async function hardDeleteUser(formData: FormData): Promise<void> {
  await requireRole("SUPER_ADMIN");
  const userId = String(formData.get("userId"));
  await applyHardDelete({ userId });
  revalidatePath("/admin/users");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- user-admin-actions`
Expected: 신규 3개 포함 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/(app)/admin/users/actions.ts test/user-admin-actions.test.ts
git commit -m "feat: 비활성 사용자 하드 삭제 서버 액션(applyHardDelete/hardDeleteUser)"
```

---

### Task 4: UI — 완전 삭제 버튼

**Files:**
- Create: `src/app/(app)/admin/users/DeleteUserButton.tsx`
- Modify: `src/app/(app)/admin/users/page.tsx`

**Interfaces:**
- Consumes: Task 3의 `hardDeleteUser` 서버 액션.
- Produces: `status === "INACTIVE"`인 행에만 confirm 확인창이 달린 "완전 삭제" 버튼을 노출한다.

- [ ] **Step 1: 버튼 컴포넌트 생성**

`src/app/(app)/admin/users/DeleteUserButton.tsx` 생성. 기존 `settings/clients/DeleteClientButton.tsx` 패턴을 따른다.

```tsx
"use client";

import { hardDeleteUser } from "./actions";

// 최고관리자 전용 하드 삭제 버튼. 되돌릴 수 없으므로 이메일을 강조한 확인창을 둔다.
export function DeleteUserButton({ id, email }: { id: string; email: string }) {
  return (
    <form
      action={hardDeleteUser}
      onSubmit={(e) => {
        if (!confirm(`'${email}' 계정을 완전히 삭제하시겠습니까?\n되돌릴 수 없습니다.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={id} />
      <button type="submit" className="rounded border border-[var(--color-danger)] px-2 py-1 text-[var(--color-danger)]">
        완전 삭제
      </button>
    </form>
  );
}
```

- [ ] **Step 2: page.tsx에서 버튼 노출**

`src/app/(app)/admin/users/page.tsx` 상단 import에 컴포넌트를 추가한다.

```tsx
import { DeleteUserButton } from "./DeleteUserButton";
```

그리고 기존 비활성화 폼 블록(56-64행)의 `{u.status === "ACTIVE" && ( ... )}` 바로 뒤에, INACTIVE 조건 블록을 추가한다.

```tsx
                {u.status === "INACTIVE" && (
                  <DeleteUserButton id={u.id} email={u.email} />
                )}
```

최종적으로 작업 셀은 다음 형태가 된다(발췌):
```tsx
                {u.status === "ACTIVE" && (
                  <form action={changeStatus}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="status" value="INACTIVE" />
                    <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1">
                      비활성화
                    </button>
                  </form>
                )}
                {u.status === "INACTIVE" && (
                  <DeleteUserButton id={u.id} email={u.email} />
                )}
```

- [ ] **Step 3: 타입 체크 + 빌드**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

Run: `npm run build`
Expected: 빌드 성공.

- [ ] **Step 4: 수동 확인**

`npm run dev` 후 `/admin/users`에 최고관리자로 접속.
Expected:
- 활성 사용자 행에는 "비활성화" 버튼만.
- 비활성 사용자 행에는 "활성화"(approveUser)와 "완전 삭제" 버튼이 함께 노출.
- "완전 삭제" 클릭 시 confirm 창 → 확인하면 목록에서 사라짐.
- (선택) 지급요청 이력이 있는 비활성 사용자 삭제 후, 지급요청 탭에서 해당 건 신청인이 "(삭제된 사용자)"로 표시되는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/app/(app)/admin/users/DeleteUserButton.tsx src/app/(app)/admin/users/page.tsx
git commit -m "feat: 사용자 관리에 비활성 계정 완전 삭제 버튼 추가"
```

---

## Self-Review 결과

- **스펙 커버리지:** 스키마 마이그레이션(Task 1), 신청인 null 파급(Task 2), 코어+액션(Task 3), UI(Task 4) — 스펙의 모든 변경 항목 매핑됨. RLS DELETE 리스크는 사전 검증으로 해소되어 Global Constraints에 명시.
- **플레이스홀더:** 없음. 모든 코드/명령 구체화됨.
- **타입 일관성:** `applyHardDelete({ userId })` 시그니처가 Task 3 정의와 Task 4 폼 필드(`userId`), 테스트 호출과 일치. `PaymentRequestRow.requesterId: string | null`이 Task 2 전반에서 일관.
- **성공 기준:** 비활성 계정만 버튼 노출·삭제(쿼리 가드), 지급요청 보존+신청인 표시, 활성 계정 차단, 코어 단위 테스트 — 모두 태스크로 커버됨.
