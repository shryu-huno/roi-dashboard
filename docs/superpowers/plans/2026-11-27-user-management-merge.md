# 유저 관리 통합 (팀 관리 + 사용자 관리) Implementation Plan

> 참고 기획서: `docs/superpowers/specs/2026-11-27-user-management-merge-design.md`
> 참고 목업: `user-management-mockup.html` (A안)

**Goal:** 최고관리자용 "팀 관리(`/admin/teams`)"와 "사용자 관리(`/admin/users`)"를, **왼쪽 조직 트리 + 오른쪽 구성원 표 + 편집 드로어** 형태의 단일 화면 **"유저 관리(`/admin/users`)"**로 통합한다.

**확정 설계(리뷰 반영):**
- 트리 선택(어느 팀·파트·그룹을 보는지)은 **URL 쿼리 파라미터**(`?team=` / `?part=` / `?status=`)로 관리 — 서버 컴포넌트에서 `searchParams`로 필터.
- 구성원 편집은 **우측 슬라이드 드로어**(클라이언트 state)로, **저장/승인/비활성화/삭제 성공 시 자동으로 닫힌다**(`useActionState` + `@/lib/action-state`).

**Architecture:**
- 필터 = URL. 드로어 열림/편집대상 = 클라이언트 state(컨텍스트). 두 관심사를 분리한다(목업의 `sel` vs `editingId` 구조와 동일).
- 서버 액션 **코어 로직·DB 스키마는 무변경**. 팀·파트 CRUD(`teams/actions.ts`)와 승인·상태·삭제 코어(`applyApproval`/`applyStatus`/`applyHardDelete`)를 그대로 재사용.
- 드로어 폼 액션(`approveUser`/`changeStatus`/`hardDeleteUser`)만 `(formData)=>void`(throw) → **`(prev, formData)=>Promise<ActionState>`**(반환)로 전환해 성공 신호로 드로어를 닫는다. 코어는 이미 `{ok,error}`를 반환하므로 래핑만 바뀐다.
- 팀·파트 CRUD 폼은 기존처럼 plain `action` + 실패 시 `error.tsx`(현 팀 관리 UX 유지). `revalidatePath`만 `/admin/users`로.

**Tech Stack:** Next.js 16 (App Router, Server Actions, async `searchParams`), React 19 (`useActionState`), Prisma 6 + PostgreSQL(Supabase, RLS), Vitest, TypeScript.

## Global Constraints

- 권한: 페이지·모든 액션 `requireRole("SUPER_ADMIN")` 유지(병합 전후 동일).
- **DB 스키마·마이그레이션 변경 없음.** 액션 코어(`applyApproval`/`applyStatus`/`applyHardDelete`, `createPart`/`deleteTeam` 등) 로직 변경 없음.
- 기존 코드 스타일(한국어 주석, 토큰 클래스 `var(--color-*)`, uncontrolled 폼 관례)을 따른다. 요청 범위 밖 리팩터링 금지.
- `@/lib/action-state`의 `ActionState`/`OK`/`SAVED`를 재사용한다(신규 상태 타입 만들지 않음).
- `TeamPartFields.tsx`는 **그대로 재사용**(드로어 폼 안에서). 수정 금지.
- v1 범위에서 제외: 사이드바 승인대기 배지, 전체 목록의 검색·역할필터(후속). 트리/표/편집/팀·파트 관리가 핵심.

---

### Task 1: 내비게이션 통합 + 테스트

**Files:**
- Modify: `src/lib/shell/nav.ts:27-28`
- Modify: `test/nav.test.ts:20`

**Interfaces:**
- Produces: `SUPER_ADMIN` nav 끝이 `… "/settings/clients", "/admin/users"`(단일 "유저 관리")로 바뀐다.

- [ ] **Step 1: nav.ts 두 항목을 하나로**

변경 전:
```ts
  if (canManageTeams(role)) items.push({ href: "/admin/teams", label: "팀 관리" });
  if (canManageUsers(role)) items.push({ href: "/admin/users", label: "사용자 관리" });
```
변경 후:
```ts
  // 팀 관리·사용자 관리를 "유저 관리" 한 화면으로 통합(조직 트리 + 구성원 표). 둘 다 최고관리자 전용.
  if (canManageUsers(role)) items.push({ href: "/admin/users", label: "유저 관리" });
```
- `canManageTeams` import는 이 변경으로 미사용이 되면 제거한다(rbac.ts의 함수 정의 자체는 남겨 둠 — 다른 참조 가능성).

- [ ] **Step 2: nav.test.ts 기대값 수정**

`"SUPER_ADMIN adds team and user management"` 케이스:
```ts
  it("SUPER_ADMIN adds unified user management (유저 관리)", () => {
    expect(hrefs("SUPER_ADMIN")).toEqual(["/dashboard", "/clients", "/performance", "/weekly-share", "/billing", "/settings/clients", "/admin/users"]);
  });
```

- [ ] **Step 3: 검증** — `npm test -- nav` → 통과. 사이드바에 "유저 관리" 하나만.

---

### Task 2: 서버 액션 조정 (드로어용 ActionState 반환 + revalidate 경로)

**Files:**
- Modify: `src/app/(app)/admin/users/actions.ts` (폼 액션 3종 시그니처)
- Modify: `src/app/(app)/admin/teams/actions.ts` (revalidatePath 6곳)

**Interfaces:**
- Produces: `approveUser`/`changeStatus`/`hardDeleteUser`가 `(prev: ActionState, formData: FormData) => Promise<ActionState>`로 바뀌어 `useActionState`에서 성공/실패를 받을 수 있다. 팀·파트 액션은 통합 화면(`/admin/users`)을 갱신한다.
- **코어 함수(`applyApproval`/`applyStatus`/`applyHardDelete`)는 변경하지 않는다** → `test/user-admin-actions.test.ts` 영향 없음.

- [ ] **Step 1: `users/actions.ts` 폼 액션을 ActionState 반환으로 전환**

상단 import 추가:
```ts
import { type ActionState, SAVED } from "@/lib/action-state";
```
`approveUser` 변경(throw → 반환):
```ts
export async function approveUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("SUPER_ADMIN");
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role")) as AppRole;
  const teamId = String(formData.get("teamId") ?? "") || null;
  const partId = String(formData.get("partId") ?? "") || null;
  const result = await applyApproval({ userId, role, teamId, partId });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/users");
  return SAVED;
}
```
`changeStatus`, `hardDeleteUser`도 동일 패턴(성공 시 `revalidatePath("/admin/users")` 후 `return SAVED`, 실패 시 `return { ok:false, error }`). `applyStatus`/`applyHardDelete`는 이미 `{ok,error}` 반환.

- [ ] **Step 2: `teams/actions.ts` revalidatePath 변경**

6개 액션의 `revalidatePath("/admin/teams")` → `revalidatePath("/admin/users")`로 모두 교체. (그 외 로직·시그니처 무변경. 실패 시 `throw`로 `error.tsx` 표시하는 현 동작 유지.)

- [ ] **Step 3: 검증** — `npx tsc --noEmit`(또는 `npm run build` 전 단계)에서 타입 에러 없음. `npm test -- user-admin-actions` 통과(코어 미변경).

---

### Task 3: 조직 트리 + 그룹 헤더 (서버 프레젠테이션 컴포넌트)

**Files:**
- Create: `src/app/(app)/admin/users/OrgTree.tsx`
- Create: `src/app/(app)/admin/users/GroupHeader.tsx`

**Interfaces:**
- Consumes: page.tsx가 계산한 `sel`(현재 선택 키), 팀·파트 목록, 그룹별 인원수, 파트장 이름.
- Produces: 트리는 `<Link href="?team=…">`로 선택을 URL에 반영. 헤더는 선택 그룹별 UI + 팀·파트 CRUD 폼.

- [ ] **Step 1: `OrgTree.tsx` (server component, 순수 렌더)**

입력 props(serializable): `sel: string`, `teams: { id; name; parts: {id;name}[] }[]`, `counts: { total; pending; unassigned; team: Record<id,n>; part: Record<id,n> }`.
렌더(목업 `renderTree` 대응):
- `전체 구성원`(`href="/admin/users"`, total), `승인 대기`(`?status=pending`, pending 배지)
- 구분선 + "팀 · 파트" 라벨
- 각 팀 `?team=<id>`(countTeam), 그 아래 파트 `?part=<id>`(countPart, 들여쓰기 `└`)
- `팀 미배정`(`?team=none`, unassigned)
- active 판정: `sel === key`일 때 `bg-[var(--color-hover)] font-semibold text-blue-700` + `aria-current`
- 하단 "새 팀" 추가 폼: `<form action={createTeamAction}>`(teams/actions.ts import).

- [ ] **Step 2: `GroupHeader.tsx` (server component)**

입력 props: `sel`, 선택된 팀/파트 객체, 인원수, 파트장 이름 맵.
목업 `renderHeader` 분기 대응:
- `all`: 제목 "전체 구성원" (검색·역할필터는 v1 제외 — 자리만, 또는 생략). 승인대기 n>0이면 안내 배너(`<Link href="?status=pending">대기 목록 보기</Link>`).
- `pending` / `unassigned`: 제목 + 설명 문구.
- 팀 선택: 팀 이름 + 소속/파트 수 + 버튼 `이름 변경`(`renameTeamAction` 폼) · `+ 파트 추가`(`createPartAction` 폼) · `팀 삭제`(`deleteTeamAction` 폼) + 파트 칩들(`<Link href="?part=…">`).
- 파트 선택: `팀 > 파트` 경로(`<Link href="?team=…">` + 제목) + `이름 변경`(`renamePartAction`) · `파트 삭제`(`deletePartAction`).
- 팀·파트 폼은 plain `action`(실패 시 error.tsx). 인라인 input + 버튼은 현 `teams/page.tsx` 스타일 재사용.

- [ ] **Step 3: 검증** — 타입 통과. (화면 확인은 Task 5 page 조립 후.)

---

### Task 4: 편집 드로어 (클라이언트, 자동 닫힘)

**Files:**
- Create: `src/app/(app)/admin/users/UserAdminProvider.tsx` ("use client")
- Create: `src/app/(app)/admin/users/EditUserButton.tsx` ("use client")
- Create: `src/app/(app)/admin/users/UserEditPanel.tsx` ("use client")

**Interfaces:**
- `UserAdminProvider`: 컨텍스트(`editing: EditUser | null`, `openEditor(u)`, `closeEditor()`)를 제공하고, 자식(서버 렌더 트리/헤더/표)과 함께 `<UserEditPanel>`을 호스팅한다. props로 `teams`, `parts`를 받아 패널에 전달.
- `EditUserButton`: 표 행에서 `openEditor(user)`를 호출하는 트리거. 서버가 전달한 serializable `user`를 props로.
- `UserEditPanel`: `editing`이 있으면 드로어 표시. 역할·팀·파트 폼(`TeamPartFields` 재사용) + 비활성화/삭제. **성공 시 `closeEditor()`**.

- [ ] **Step 1: `UserAdminProvider.tsx` — 컨텍스트 + 드로어 호스트**

```tsx
"use client";
import { createContext, useContext, useState } from "react";
import { UserEditPanel, type EditUser } from "./UserEditPanel";

type Team = { id: string; name: string };
type Part = { id: string; name: string; teamId: string };
type Ctx = { openEditor: (u: EditUser) => void; closeEditor: () => void };

const EditorCtx = createContext<Ctx | null>(null);
export const useEditor = () => {
  const c = useContext(EditorCtx);
  if (!c) throw new Error("useEditor must be used within UserAdminProvider");
  return c;
};

export function UserAdminProvider({
  teams, parts, children,
}: { teams: Team[]; parts: Part[]; children: React.ReactNode }) {
  const [editing, setEditing] = useState<EditUser | null>(null);
  return (
    <EditorCtx.Provider value={{ openEditor: setEditing, closeEditor: () => setEditing(null) }}>
      {children}
      <UserEditPanel editing={editing} teams={teams} parts={parts} />
    </EditorCtx.Provider>
  );
}
```
> 서버 렌더된 `children`(트리/헤더/표)을 클라이언트 프로바이더가 감싸고, 그 안의 클라이언트 트리거(`EditUserButton`)가 같은 컨텍스트를 소비한다. 필터는 URL에만, 편집 대상은 이 state에만 — 서로 독립.

- [ ] **Step 2: `EditUserButton.tsx` — 행 트리거**

```tsx
"use client";
import { useEditor } from "./UserAdminProvider";
import type { EditUser } from "./UserEditPanel";

export function EditUserButton({ user, label }: { user: EditUser; label: string }) {
  const { openEditor } = useEditor();
  const cls = user.status === "PENDING"
    ? "rounded bg-[var(--color-primary)] px-3 py-1.5 text-xs text-white"
    : "rounded border border-[var(--color-border)] px-3 py-1.5 text-xs";
  return <button type="button" className={cls} onClick={() => openEditor(user)}>{label}</button>;
}
```

- [ ] **Step 3: `UserEditPanel.tsx` — 드로어 + useActionState 자동 닫힘**

핵심 포인트:
- `type EditUser = { id; name: string|null; email; role: AppRole|null; teamId: string|null; partId: string|null; status }` export(트리거·프로바이더 공용).
- 세 폼 각각 `useActionState`:
  ```tsx
  const [saveState, saveAction] = useActionState(approveUser, OK);
  const [statusState, statusAction] = useActionState(changeStatus, OK);
  const [deleteState, deleteAction] = useActionState(hardDeleteUser, OK);
  ```
- 자동 닫힘(기존 `NewClientForm` 패턴과 동일 — 초기 `OK`는 `message` 없음, 성공은 `SAVED`로 `message` 있음):
  ```tsx
  useEffect(() => {
    if (saveState.message || statusState.message || deleteState.message) closeEditor();
  }, [saveState, statusState, deleteState]);
  ```
- 드로어는 `editing`이 null이면 렌더 안 함(또는 hidden). 열릴 때 `editing`으로 초기값 설정. `editing.id`를 폼 컨테이너 `key`로 줘 사용자 전환 시 폼이 새로 초기화되게 한다.
- 역할 select(`name="role"`) + `<TeamPartFields teams parts defaultTeamId defaultPartId />`(그대로 재사용, `name="teamId"`/`name="partId"` 제공). hidden `name="userId"`.
- 저장 버튼 라벨: `editing.status === "ACTIVE" ? "저장" : "저장하고 활성화"`.
- 비활성화 버튼: `status==="ACTIVE"`일 때만. `<form action={statusAction}>` + hidden `userId`, `status="INACTIVE"`.
- 계정 삭제 버튼: `status==="INACTIVE"`일 때만. `<form action={deleteAction}>` + `onSubmit` `confirm()`(기존 `DeleteUserButton` 문구 재사용) + hidden `userId`.
- 실패 표시: `!state.ok && state.error`면 상단에 붉은 문구(닫히지 않음).
- 접근성: 기존 목업의 `role="dialog" aria-modal` + Esc 닫기 + 바깥 클릭 닫기(선택).

- [ ] **Step 4: 검증** — 타입 통과. (동작 확인은 Task 5 후.)

---

### Task 5: page.tsx 재구성 (searchParams 필터 + 조립)

**Files:**
- Modify: `src/app/(app)/admin/users/page.tsx` (전면 재작성)

**Interfaces:**
- Consumes: `searchParams`(Promise, Next 16) — `team`/`part`/`status`.
- Produces: 트리+헤더+표 통합 화면. 표 행의 작업 버튼 = `EditUserButton`.

- [ ] **Step 1: 데이터 조회 + 선택 해석**

```tsx
export default async function AdminUsersPage(
  { searchParams }: { searchParams: Promise<{ team?: string; part?: string; status?: string }> },
) {
  await requireRole("SUPER_ADMIN");
  const sp = await searchParams;
  const [users, teams, parts] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" }, include: { parts: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } } }),
    prisma.part.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  // sel: 현재 선택 키("all" | "pending" | "unassigned" | teamId | partId)
  const sel = sp.status === "pending" ? "pending"
    : sp.team === "none" ? "unassigned"
    : sp.part ? sp.part
    : sp.team ? sp.team
    : "all";
  // ...
}
```

- [ ] **Step 2: 필터 + 카운트(목업 규칙과 동일)**

- `isActiveMember = (u) => u.status !== "PENDING"`.
- 표 대상 `filteredUsers`:
  - `pending` → `status==="PENDING"`
  - `unassigned` → `!teamId && isActiveMember`
  - partId → `partId===sel && isActiveMember`
  - teamId → `teamId===sel && isActiveMember`
  - else → 전체
- 트리 counts: `total=users.length`, `pending=PENDING 수`, `unassigned=!teamId&&active`, 팀·파트별 `isActiveMember` 집계. (현 teams 페이지의 `_count.members`는 전체를 세므로 사용하지 않고 `users`에서 직접 계산 — 트리 숫자 규칙 일관성.)
- 파트장 이름 맵: 기존 `leaderOfPart`(활성 `PART_LEADER` by partId) 재사용.

- [ ] **Step 3: 조립**

```tsx
return (
  <UserAdminProvider
    teams={teams.map((t) => ({ id: t.id, name: t.name }))}
    parts={parts.map((p) => ({ id: p.id, name: p.name, teamId: p.teamId }))}
  >
    <div className="mb-5 flex flex-wrap items-baseline gap-3">
      <h1 className="text-xl font-semibold">유저 관리</h1>
      <span className="text-sm text-[var(--color-muted)]">전체 {users.length}명 · 승인 대기 {pending}명 · 팀 {teams.length}개</span>
    </div>
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <aside className="w-full shrink-0 lg:w-[260px]">
        <OrgTree sel={sel} teams={...} counts={...} />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <GroupHeader sel={sel} ... />
        <div className="overflow-x-auto rounded-[14px] border ...">
          <table>…
            {filteredUsers.map((u) => (
              <tr key={u.id}>
                …이름/역할/팀·파트/상태…
                <td className="text-right">
                  <EditUserButton
                    user={{ id: u.id, name: u.name, email: u.email, role: u.role, teamId: u.teamId, partId: u.partId, status: u.status }}
                    label={u.status === "PENDING" ? "승인하기" : "편집"} />
                </td>
              </tr>
            ))}
          </table>
          {filteredUsers.length === 0 && <p className="…">이 그룹에 속한 구성원이 없습니다.</p>}
        </div>
      </section>
    </div>
  </UserAdminProvider>
);
```
- 표 "팀 · 파트" 열: `teamName (· partName)` 형식(목업). 상태 pill·행 강조(PENDING amber, INACTIVE muted)는 기존 스타일 재사용.

- [ ] **Step 4: 검증(수동)** — `npm run dev` → 최고관리자로 `/admin/users`:
  - 트리 클릭 시 URL(`?team=`/`?part=`/`?status=`) 변경 + 표 필터 + active 표시. 트리 숫자 일치.
  - 팀/파트 이름변경·추가·삭제 동작(성공 시 화면 갱신, 실패 시 error 화면).
  - 행 "편집/승인하기" → 드로어 열림 → 역할·팀·파트 저장 → **드로어 자동 닫힘** + 표 반영. 승인(PENDING→ACTIVE), 비활성화, (비활성)삭제 각각 자동 닫힘 확인. 검증 실패(예: 파트장 중복) 시 드로어 안 닫히고 오류 문구.

---

### Task 6: 기존 라우트 redirect + 고아 파일 정리

**Files:**
- Modify: `src/app/(app)/admin/teams/page.tsx` → redirect
- Delete: `src/app/(app)/admin/users/DeleteUserButton.tsx` (재작성으로 고아화 — 삭제 로직은 드로어로 이동)

**Interfaces:**
- Produces: `/admin/teams` 접속 시 `/admin/users`로 이동(북마크 보호). `teams/actions.ts`는 OrgTree/GroupHeader가 계속 import하므로 **유지**.

- [ ] **Step 1: `teams/page.tsx`를 redirect로 교체**
```tsx
import { redirect } from "next/navigation";
export default function AdminTeamsPage() {
  redirect("/admin/users");
}
```

- [ ] **Step 2: `DeleteUserButton.tsx` 삭제** — 기존 page.tsx에서만 쓰였고 재작성으로 미사용. 삭제 기능은 `UserEditPanel` 안으로 흡수(`hardDeleteUser` + confirm). *import 잔재 없는지 grep 확인 후 삭제.*

- [ ] **Step 3: 검증** — `/admin/teams` → `/admin/users` 리다이렉트. grep `DeleteUserButton` 참조 0건.

---

### Task 7: 전체 검증

- [ ] **Step 1:** `npm test` 전체 그린(특히 `nav.test.ts`, `user-admin-actions.test.ts`).
- [ ] **Step 2:** `npm run build` 성공(타입·린트).
- [ ] **Step 3: 수동 시나리오**(최고관리자)
  - 사이드바에 "유저 관리" 하나.
  - 전체/승인대기/팀/파트/팀미배정 트리 이동·필터·카운트.
  - 팀·파트 CRUD → 통합 화면 즉시 갱신.
  - 드로어: 승인·저장·비활성화·삭제 모두 성공 시 자동 닫힘, 실패 시 오류 표시·유지.
  - `/admin/teams` 리다이렉트.

---

## 파일 요약

| 파일 | 작업 |
|---|---|
| `src/lib/shell/nav.ts` | 두 항목 → "유저 관리" 하나 |
| `test/nav.test.ts` | SUPER_ADMIN 기대값 수정 |
| `admin/users/actions.ts` | 폼 액션 3종 → `ActionState` 반환 |
| `admin/teams/actions.ts` | `revalidatePath` 6곳 → `/admin/users` |
| `admin/users/OrgTree.tsx` | **신규**(서버) 조직 트리 |
| `admin/users/GroupHeader.tsx` | **신규**(서버) 그룹 헤더 + 팀·파트 CRUD |
| `admin/users/UserAdminProvider.tsx` | **신규**(client) 컨텍스트 + 드로어 호스트 |
| `admin/users/EditUserButton.tsx` | **신규**(client) 행 트리거 |
| `admin/users/UserEditPanel.tsx` | **신규**(client) 편집 드로어(자동 닫힘) |
| `admin/users/page.tsx` | 재작성(트리+헤더+표, searchParams 필터) |
| `admin/teams/page.tsx` | `redirect("/admin/users")` |
| `admin/users/DeleteUserButton.tsx` | **삭제**(드로어로 흡수) |
| `admin/users/TeamPartFields.tsx` | 재사용(무변경) |
| `admin/teams/actions.ts` 코어 | 재사용(무변경) |

## 범위 밖 (후속)
- 사이드바 "유저 관리" 승인대기 배지(셸 레이아웃에 pendingCount 조회 필요).
- 전체 목록의 검색(`?q=`)·역할필터(`?role=`) 서버 구현.
- `teams/actions.ts` 물리 이동/리네이밍.
