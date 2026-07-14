# 고객사 소프트 삭제(보관) — 설계

작성일: 2026-07-13

## 배경

`/settings/clients`에서 정산담당자·관리자가 고객사를 생성/수정하고 과업·담당 PM을
관리할 수 있으나 **삭제 기능이 없다**. 관리자 전용으로, 데이터를 지우지 않고 목록에서만
숨기는 소프트 삭제(보관)를 추가한다.

## 요구사항

- 소프트 삭제: 고객사를 목록에서 숨기되 연관 데이터(과업·청구·입금·지출·실적)는 보존.
- **관리자(ADMIN) 전용.** 정산담당자는 `/settings/clients`를 볼 수 있어도 삭제 불가.
- 위치: `/settings/clients` 관리 목록의 각 고객사 행.

## 설계

### 1. 스키마 + 마이그레이션
- `Client`에 `deletedAt DateTime?` 추가 (null = 활성, 타임스탬프 = 보관됨).
- 마이그레이션 `add_client_deleted_at`.
- RLS 변경 불필요. 보관은 일반 `UPDATE`이며 숨김은 쿼리 `where` 필터로 처리.

### 2. 데이터 계층 (`src/lib/data/clients.ts`)
- `archiveClient(ctx, id): Promise<ActionState>`
  - `updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } })`
  - `count === 0` → `{ ok:false, error }` (없음/권한 없음). 기존 `updateClient` 방식과 동일.
- `listClients`에 `where: { deletedAt: null }` 추가 → 모든 목록 화면에서 보관 고객사 제외.
- `metrics.ts`의 `getClientSummaries` `client.findMany`에도 동일 필터 → 대시보드 집계 제외.
- `getClient` / `getClientDetail`는 변경하지 않음(직접 URL 접근은 문제 없음, 변경 최소화).

### 3. 서버 액션 (`settings/clients/actions.ts`)
- `archiveClientAction(formData): Promise<void>`
  - `requireRole("ADMIN")` — 서버에서 관리자 강제.
  - `archiveClient` 호출 후 `revalidatePath("/settings/clients")`.

### 4. UI
- `settings/clients/page.tsx`: `isAdmin = user.role === "ADMIN"` 계산, "작업" 열에
  관리자에게만 삭제 버튼 표시.
- `ArchiveClientButton` (신규 클라이언트 컴포넌트): 숨은 `id` + `confirm()` 확인창과 함께
  `archiveClientAction` 실행. 확인 문구로 "숨김·데이터 보존"임을 안내.

### 5. 테스트 (`test/data-clients.test.ts`)
- 보관 후 `listClients`에서 제외되나 과업 데이터는 유지.
- 비관리자(PM)의 타 고객사 보관 시도 → `ok:false` (RLS).

## 범위 제외
- `/clients` 페이지의 삭제 컨트롤.

## 개정 (2026-07-13, 사용자 확인 후 추가)

초기 설계는 목록·per-client 표에서만 보관 고객사를 제외했으나, 전사 상단 KPI는
`getPeriodTotals`/`getContractTotal`/`getMonthlyTrend`/`getExpenseBreakdown`가 자식
테이블을 직접 집계하여 **보관 고객사가 여전히 포함되는 불일치**가 있었다. 사용자 결정에 따라 보완:

1. **전사 집계 완전 제외** — 위 4개 함수의 `where`에 관계 필터 추가
   (`client: { deletedAt: null }`, 실적은 `task: { client: { deletedAt: null } }`).
2. **보관 목록 + 복원 UI** (관리자 전용)
   - 데이터 계층: `listArchivedClients(ctx)`, `restoreClient(ctx, id)` 추가.
   - 서버 액션: `restoreClientAction` (`requireRole("ADMIN")`).
   - UI: `/settings/clients`에 "보관된 고객사" 섹션 + `RestoreClientButton`(복원, 확인창 없음).
