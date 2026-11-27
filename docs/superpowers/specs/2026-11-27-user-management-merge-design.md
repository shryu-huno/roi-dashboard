# 유저 관리 통합 기획서 (팀 관리 + 사용자 관리 → 유저 관리)

- 작성일: 2026-11-27
- 참고 목업: `user-management-mockup.html` (A안 — 조직 트리 + 구성원 표 + 편집 드로어)
- 상태: 리뷰 대기 (구현 착수 전)

---

## 1. 배경 · 목적

현재 최고관리자용 관리 메뉴가 **팀 관리(`/admin/teams`)**, **사용자 관리(`/admin/users`)** 두 개로 나뉘어 있다. 하지만 둘은 사실상 하나의 업무(조직 구성 + 구성원 배정)를 다루고, 둘 다 `SUPER_ADMIN` 전용이라 오가며 작업해야 하는 불편이 있다.

목업 A안대로 **왼쪽 조직 트리 + 오른쪽 구성원 표 + 편집 드로어** 형태의 단일 화면 **"유저 관리"(`/admin/users`)**로 통합한다. 팀/파트를 고르면 오른쪽에 해당 구성원만 걸러 보이고, 팀/파트 관리(이름변경·추가·삭제)는 선택된 그룹 헤더에서 바로 한다.

**성공 기준**
- 사이드바에 "유저 관리" 단일 항목만 보인다(팀 관리·사용자 관리 사라짐).
- `/admin/users` 한 화면에서 ① 팀/파트 생성·이름변경·삭제 ② 구성원 역할·팀·파트 배정 ③ 승인·비활성화·삭제가 모두 가능하다.
- 기존 서버 액션(`approveUser`/`changeStatus`/`hardDeleteUser`, 팀·파트 CRUD)과 검증 로직은 그대로 재사용한다. **DB 스키마·액션 코어 로직 변경 없음.**
- 기존 `/admin/teams` 북마크가 깨지지 않는다.

---

## 2. 현재 상태 (As-Is)

### 2.1 내비게이션 — `src/lib/shell/nav.ts`
```ts
if (canManageTeams(role)) items.push({ href: "/admin/teams", label: "팀 관리" });
if (canManageUsers(role)) items.push({ href: "/admin/users", label: "사용자 관리" });
```
- `canManageTeams`, `canManageUsers` 모두 `role === "SUPER_ADMIN"` (→ `src/lib/auth/rbac.ts`). **권한이 완전히 동일**하므로 병합 시 가드 충돌 없음.

### 2.2 팀 관리 — `src/app/(app)/admin/teams/`
- `page.tsx`: `requireRole("SUPER_ADMIN")`. 팀 목록(소속 인원수·파트 목록·파트별 인원수·파트장) 렌더 + 팀 추가 폼. 각 팀 카드에 이름변경/삭제, 파트 추가/이름변경/삭제 폼.
- `actions.ts`: `createTeamAction` / `renameTeamAction` / `deleteTeamAction` / `createPartAction` / `renamePartAction` / `deletePartAction`. 모두 `SUPER_ADMIN` + RLS 컨텍스트 주입, 끝에 `revalidatePath("/admin/teams")`.

### 2.3 사용자 관리 — `src/app/(app)/admin/users/`
- `page.tsx`: `requireRole("SUPER_ADMIN")`. 전체 사용자 표(이메일·이름·역할·팀·파트·상태·작업). 행마다 역할 select + `TeamPartFields`(팀·파트 select) + 저장/활성화 버튼, 활성이면 비활성화, 비활성이면 완전삭제 버튼.
- `actions.ts`: 코어 `applyApproval`/`applyStatus`/`applyHardDelete`(테스트 대상, 세션 비의존) + 폼 액션 `approveUser`/`changeStatus`/`hardDeleteUser`. 끝에 `revalidatePath("/admin/users")`.
- `TeamPartFields.tsx` ("use client"): 팀·파트 연동 드롭다운. **uncontrolled + `key`** 로 React 19 폼 자동초기화 대응(저장된 값이 화면에 유지되도록).
- `DeleteUserButton.tsx` ("use client"): `confirm()` 1회 후 하드 삭제.

### 2.4 영향받는 테스트
- `test/nav.test.ts`: `SUPER_ADMIN`의 nav 목록을 **정확히** 단언 → 끝 두 항목 `"/admin/teams", "/admin/users"`를 `"/admin/users"` 하나로 수정 필요.
- `test/user-admin-actions.test.ts`: 액션 코어(`applyApproval` 등) 대상. **로직 변경 없으므로 수정 불필요**(확인만).

---

## 3. 목표 화면 (To-Be) — 목업 A안

```
┌─ 사이드바 ──┐┌─ main (/admin/users) ───────────────────────────────┐
│ …          ││ 유저 관리   전체 N명 · 승인 대기 n명 · 팀 t개         │
│ 유저 관리 🔴││ ┌─ 조직 트리 ──┐┌─ 그룹 헤더 + 구성원 표 ───────────┐ │
│ …          ││ │ 전체 구성원   ││ (선택 그룹 헤더: 팀/파트 관리 버튼) │ │
│            ││ │ 승인 대기 n   ││ ┌───────────────────────────────┐ │ │
│            ││ │ ── 팀·파트 ──││ │ 이름 │역할│팀·파트│상태│작업    │ │ │
│            ││ │ 1팀           ││ │ …                              │ │ │
│            ││ │  └ 1파트      ││ └───────────────────────────────┘ │ │
│            ││ │ 팀 미배정     ││                                     │ │
│            ││ │ [+ 새 팀]     ││                                     │ │
│            ││ └──────────────┘└────────────────────────────────────┘ │
└────────────┘└──── (편집은 우측 슬라이드 드로어로) ────────────────────┘
```

구성(목업 → 레포 매핑):
- **좌: 조직 트리** — 전체 구성원 / 승인 대기 / 팀·파트 목록(인원수) / 팀 미배정 / 새 팀 추가 폼
- **우: 그룹 헤더** — 선택된 그룹에 따라 달라짐
  - 전체: 검색·역할필터 + 승인대기 안내 배너
  - 승인 대기 / 팀 미배정: 설명 문구
  - 팀 선택: 팀 이름변경 / 파트 추가 / 팀 삭제 + 파트 칩 목록
  - 파트 선택: 팀 > 파트 경로 + 파트 이름변경 / 파트 삭제
- **우: 구성원 표** — 이름·역할·팀·파트·상태 + 작업(편집/승인하기). 행 클릭 또는 작업 버튼 → 편집 드로어
- **편집 드로어** — 역할·팀·파트 select + 저장(활성화) / 비활성화 / 계정 삭제

---

## 4. 라우팅 · 선택 상태 설계

> **결정 1 (권장: URL 쿼리 파라미터)** — 목업은 JS `sel` 변수로 선택을 관리하지만, 실제 페이지는 서버 컴포넌트다. 선택 상태를 **`searchParams`**로 받으면 SSR에서 바로 필터링·새로고침·공유·뒤로가기가 자연스럽다.

| 선택 | URL | 서버 필터 |
|---|---|---|
| 전체 구성원 | `/admin/users` | 전체 |
| 승인 대기 | `/admin/users?status=pending` | `status = PENDING` |
| 팀 미배정 | `/admin/users?team=none` | `teamId = null`, `status != PENDING` |
| 특정 팀 | `/admin/users?team=<teamId>` | `teamId = <id>`, `status != PENDING` |
| 특정 파트 | `/admin/users?part=<partId>` | `partId = <id>`, `status != PENDING` |

- 트리 항목은 `<Link href=...>`로 구현(클라이언트 JS 불필요). 현재 선택은 `searchParams`로 판정해 active 스타일.
- `part` 선택 시 소속 팀(breadcrumb)은 `part.teamId`로 역산.

---

## 5. 데이터 조회 (`admin/users/page.tsx`)

트리(인원수 포함)와 표를 함께 그리므로 한 페이지에서 조회:
```
const [users, teams, parts] = await Promise.all([
  prisma.user.findMany({ orderBy: { createdAt: "asc" } }),      // 기존
  prisma.team.findMany({ ... parts 포함, _count members }),      // teams 페이지 쿼리 흡수
  prisma.part.findMany({ orderBy: [{ sortOrder }, { name }] }),  // 기존
]);
```
- 트리 인원수: 목업 로직대로 **승인대기 제외(ACTIVE/INACTIVE만 집계)**. 현 teams 페이지의 `_count.members`는 전체를 세므로, 트리 숫자는 `users` 배열에서 직접 계산(목업 `countTeam`/`countPart`와 동일 규칙)하여 일관성 유지.
- 파트장 표시: 기존 `leaderOfPart`(활성 `PART_LEADER`) 로직 재사용.

---

## 6. 서버 액션 재사용 · 변경점

**로직은 그대로, `revalidatePath`만 통합 경로로.**

| 액션 | 파일 | 변경 |
|---|---|---|
| `createTeamAction` 외 팀·파트 6종 | `admin/teams/actions.ts` | `revalidatePath("/admin/teams")` → **`"/admin/users"`** |
| `approveUser` / `changeStatus` / `hardDeleteUser` | `admin/users/actions.ts` | 이미 `"/admin/users"` — 변경 없음 |

- 코어(`applyApproval`/`applyStatus`/`applyHardDelete`, `createPart`/`deleteTeam` 등)와 RLS·검증은 **무변경**.
- 팀/파트 액션 파일은 `admin/teams/actions.ts`에 그대로 두고 통합 페이지에서 import(물리 이동 불필요 — 변경 최소화). 필요 시 후속 정리.

> **결정 2 (권장: redirect 유지)** — `src/app/(app)/admin/teams/page.tsx`를 `redirect("/admin/users")`로 교체해 기존 북마크 보호. `teams/actions.ts`는 통합 페이지가 계속 참조하므로 **삭제하지 않는다**.

---

## 7. 컴포넌트 구조

**신규**
- `OrgTree.tsx` (서버 or 순수 렌더) — 트리 목록. 각 항목 `<Link>`. active 판정은 `searchParams` 기반.
- `GroupHeader.tsx` (서버) — 선택 그룹별 헤더. 팀/파트 관리 폼(기존 `teams/actions.ts` 액션 그대로 `action={...}`). 파트 칩은 `<Link href="?part=...">`.
- `UserEditPanel.tsx` ("use client") — 편집 드로어. 내부 폼 `action={approveUser}`. 팀·파트 select는 **기존 `TeamPartFields` 재사용**. 비활성화/삭제 버튼은 `changeStatus`/`hardDeleteUser` 폼.

**수정**
- `admin/users/page.tsx` — 레이아웃을 트리+헤더+표로 재구성. `searchParams`로 필터. 표 행에 "편집/승인하기" 트리거.
- `nav.ts` — 두 항목 → `{ href: "/admin/users", label: "유저 관리" }` 하나.
- `admin/teams/page.tsx` — `redirect("/admin/users")`.
- `admin/teams/actions.ts` — `revalidatePath` 경로만 변경.

**유지(재사용)**
- `TeamPartFields.tsx`, `DeleteUserButton.tsx`(드로어 안에서 사용), `teams/actions.ts` 코어.

> **결정 3 (드로어 닫기)** — 드로어는 "use client". 서버 액션 성공 후 자동으로 닫히게 하려면 `useActionState`로 성공 신호를 받아 닫거나, 액션이 `redirect`로 통합 URL을 돌려주는 방식. 권장: **`useActionState` + `revalidatePath`** (목업처럼 저장→목록 갱신→드로어 닫힘). 단순화를 위해 1차 구현은 "저장 시 드로어 유지 + 수동 닫기"로 시작하고, 닫힘 자동화는 후속으로 둘 수도 있음 — **구현 난이도 대비 UX 가치를 리뷰에서 결정**.

---

## 8. 권한

- 페이지·모든 액션 `requireRole("SUPER_ADMIN")` 유지. 병합 전후 동일.
- `rbac.ts`의 `canManageTeams`/`canManageUsers`는 **삭제하지 않음**(둘 다 SUPER_ADMIN, 다른 곳 참조 가능성). nav에서는 하나만 사용(`canManageUsers`로 통일 권장).

---

## 9. 사이드바 승인 대기 배지 (선택)

목업 사이드바의 "유저 관리 🔴n" 배지는 **nav가 pendingCount를 알아야** 하므로 셸 레이아웃에서 추가 쿼리가 필요하다. `nav.ts`는 현재 순수 함수(역할→항목)라 데이터 패칭과 분리돼 있다.
- **범위에서 분리 권장**: 1차는 배지 없이 통합만. 배지는 셸 레이아웃 변경이 필요한 별도 작업으로 뒤로.

---

## 10. 영향받는 테스트

- `test/nav.test.ts` — `SUPER_ADMIN` 기대값 끝을 `… "/settings/clients", "/admin/users"]`로 수정(‑`/admin/teams`). **반드시 수정.**
- `test/user-admin-actions.test.ts` — 코어 미변경이므로 그대로 통과 확인.
- (해당 시) teams 관련 nav/페이지 테스트 존재 여부 확인 후 조정.

---

## 11. 구현 단계 (제안)

1. **nav 통합** → verify: `nav.test.ts` 수정·통과, 사이드바에 "유저 관리" 하나.
2. **teams → users redirect + revalidatePath 변경** → verify: `/admin/teams` 접속 시 `/admin/users`로 이동, 팀/파트 CRUD 후 통합 화면 갱신.
3. **page.tsx 재구성(트리+헤더+표, searchParams 필터)** → verify: 트리 클릭 시 URL·표 필터 동작, 인원수 일치.
4. **편집 드로어(`UserEditPanel`) + TeamPartFields 재사용** → verify: 승인/저장/비활성화/삭제 전 기능 동작.
5. **전체 수동 확인**(`npm run dev`, 최고관리자) + `npm test` 그린.

---

## 12. 범위 밖 (Non-Goals)

- DB 스키마·액션 코어 로직 변경
- 역할/권한 체계 변경
- 팀/파트 액션 파일의 물리적 이동·리네이밍
- 사이드바 승인대기 배지(별도 작업으로 분리)
- 검색·역할필터의 서버 구현(목업엔 있으나, 필요 시 후속 — 1차는 UI만/또는 제외)

---

## 열린 결정사항 요약 (리뷰에서 확정)

1. **필터 상태**: URL 쿼리 파라미터(권장) vs 클라이언트 state — §4
2. **기존 `/admin/teams`**: redirect 유지(권장) vs 제거 — §6
3. **드로어 닫기 자동화**: 1차부터 `useActionState` 자동 닫힘 vs 수동 닫힘 후속 — §7
4. **검색·역할필터**: 1차 포함 vs 후속 — §12
