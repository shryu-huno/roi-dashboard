# ROI 대시보드 — Plan 2 설계 문서 (수동 CRUD/입력 계층)

- **작성일:** 2026-07-09
- **작성자:** 류승환 (shryu@huno.kr) + Claude
- **범위:** Phase 1(1단계)의 두 번째 구현 주기. 데이터 접근 계층 + 공통 셸 + 고객사/과업/단가 설정 + 고객사 목록 + 실적/지출/청구·입금 입력.
- **상위 설계:** `docs/superpowers/specs/2026-07-08-roi-dashboard-phase1-design.md`
- **선행 구현:** `docs/superpowers/plans/2026-07-08-roi-dashboard-phase1-foundation.md` (Plan 1, 완료)

---

## 1. 배경과 위치

Phase 1 설계 문서는 1단계 전체(기반 + 수동 CRUD + 수익률 대시보드)를 정의한다. 그 구현은 세 주기로 나뉜다:

| Plan | 내용 | 상태 |
|---|---|---|
| **Plan 1** | 기반: 인증(@huno.kr Google OAuth)·RBAC·데이터 모델·PostgreSQL RLS·`withRLS`·서버 가드·관리자 사용자 승인 | 완료 |
| **Plan 2** | **본 문서** — 데이터 접근 계층 + 공통 셸 + 고객사/과업/단가 설정 + 고객사 목록 + 실적/지출/청구·입금 입력 | 설계 |
| Plan 3 | 수익률 대시보드(전사/고객사 상세 KPI·수익 흐름·추이·지출 구성) | 이후 |

Plan 1의 forward reference("데이터 접근이 필요한 후속 태스크는 `withRLS` 안에서 쿼리한다", "대시보드 본문은 Plan 3")를 그대로 잇는다.

**Plan 2 목표:** @huno.kr 사용자가 역할에 맞는 셸에서 고객사·과업·단가를 설정하고, 실적(횟수)·지출·청구·입금을 수동 입력하면 DB에 안전하게(RLS 강제) 저장되는, 배포 가능한 입력 계층을 만든다. 집계 지표 시각화는 Plan 3.

---

## 2. 범위

### 포함
- 데이터 접근 계층(`withRLS` 기반 도메인 함수)
- 공통 셸: 좌측 사이드바(역할별 메뉴) + 상단바(역할 배지·이메일·로그아웃)
- 고객사·과업·단가 설정 CRUD (ADMIN/SETTLEMENT)
- 고객사 목록 (전체, PM은 RLS로 본인 담당만)
- 실적 입력 (과업별 횟수 → 금액 자동)
- 지출 입력 (13종 분류별 금액 + 메모)
- 청구·입금 입력
- 지출 분류 enum 13종 확장(Plan 1 미완 WIP 흡수) + 유일 제약 추가

### 제외 (다른 Plan/Phase)
- 전사 대시보드, 고객사 **상세**(지표·수익 흐름·추이) → Plan 3
- 전역 기간/고객사 필터 → Plan 3 (입력 화면은 자체 `고객사+월` 선택기 사용)
- 파일 자동 파싱, 구글 심화 연동, 부가세, 순위/리더보드 → Phase 2·3 또는 범위 외

### 확정된 정책 결정 (Phase 1 설계 §10 미해결 항목 해소)
- **승인 절차 없음 — 자유 CRUD.** 실적/지출/청구·입금 모두 입력 즉시 반영. 상태 필드·승인 플로우 없음.
- **정액 과업**(예: 정액 홍보비)은 "단가=금액, 횟수=1"로 수용. 별도 모델 변경 없음.
- **역할별 입력 권한**: 실적=PM(본인 담당)+상위, 지출/청구·입금/설정=ADMIN/SETTLEMENT, 사용자 관리=ADMIN(Plan 1).

---

## 3. 아키텍처 — 데이터 접근 계층

Plan 1 위에 3층을 얹는다.

```
서버 컴포넌트(화면)          서버 액션(actions.ts)
   │ 조회                       │ ① requireRole/requireUser (인가)
   │                            │ ② zod 검증
   └──────────┬─────────────────┘ ③ 호출
              ▼
   데이터 계층  src/lib/data/<domain>.ts
   listClients(ctx) / upsertPerformanceBatch(ctx, input) ...
              │  모든 함수가 첫 인자로 RlsContext 를 받아
              ▼
   withRLS(ctx, tx => ...)   ← Plan 1 헬퍼 (트랜잭션 + set_config)
              ▼
   PostgreSQL (RLS 정책이 PM 접근을 물리적으로 차단)
```

**핵심 원칙**
- **모든 데이터 접근은 `withRLS` 경유.** 데이터 계층 함수는 `ctx: RlsContext`(`{userId, role}`)를 받아 그 안에서만 쿼리한다. RLS를 우회하는 경로를 만들지 않는다.
- **인가는 액션 진입점에서.** 서버 액션은 시작에서 `requireRole(...)`/`requireUser()`로 세션·역할을 검증하고, 그 사용자로 `ctx`를 구성해 데이터 계층에 넘긴다. → 앱 가드(1차) + RLS(2차) 이중 방어.
- **입력 검증은 zod.** 액션 경계에서 `FormData`를 zod로 파싱·형변환·검증한 뒤 타입 안전한 객체로 데이터 계층에 전달.
- **파생·불변식은 데이터 계층에.** `amount = unitPrice × count` 계산, 금액/월/연 범위, `count ≥ 0` 등을 데이터 계층 한 곳에서 강제.
- **조회/변경이 같은 데이터 계층을 공유** → 중복 없음, Plan 3 대시보드 집계가 동일 계층 재사용.

**신규 파일(개요)**
- `src/lib/data/{clients,tasks,performance,expenses,billing,deposits}.ts` — 도메인 데이터 함수
- `src/lib/validation/schemas.ts` — zod 스키마(도메인별 입력)
- `src/lib/context.ts` — 세션 → `RlsContext` 변환(`getRlsContext(sessionUser)`)
- 화면·액션 파일은 §4.

**의존성 추가**: `zod`. 그 외 신규 런타임 의존성 없음.

---

## 4. 화면/컴포넌트 구성

### 라우트 (App Router, 인증 셸 그룹 `(app)`)

| 경로 | 화면 | 접근 역할 |
|---|---|---|
| `(app)/layout.tsx` | 공통 셸(사이드바+상단바), `requireUser` 가드 | 활성 사용자 전체 |
| `(app)/clients/page.tsx` | 고객사 목록(카드/표 → 입력 화면 이동) | 전체 (PM은 RLS로 본인 담당만) |
| `(app)/performance/page.tsx` | 실적 입력(과업별 횟수) | PM + 상위 |
| `(app)/expenses/page.tsx` | 지출 입력(13종 분류·메모) | ADMIN/SETTLEMENT |
| `(app)/billing/page.tsx` | 청구·입금 입력 | ADMIN/SETTLEMENT |
| `(app)/settings/clients/**` | 고객사·과업·단가 설정(CRUD, 담당 PM 지정) | ADMIN/SETTLEMENT |

각 화면 폴더에 `actions.ts`(서버 액션)를 함께 둔다.

### 공통 셸
- **사이드바**: 세션 역할에 따라 메뉴 필터링.
  - PM: [고객사 목록, 실적 입력]
  - SETTLEMENT: + [지출 입력, 청구·입금 입력, 설정]
  - ADMIN: + [사용자 관리(Plan 1)]
  - 대시보드 메뉴 항목은 자리만 두고 Plan 3에서 채운다.
- **상단바**: 역할 배지 + 사용자 이메일 + 로그아웃. **전역 기간/고객사 필터는 Plan 3(대시보드)로 미룬다.**

### 화면별 컴포넌트 경계 (공통 패턴)
- **서버 컴포넌트**: `고객사+월` 확정 후 데이터 계층으로 현재 값 로드.
- **클라이언트 컴포넌트**: 편집 폼/그리드(입력 중 합계·금액 실시간 표시), 제출은 서버 액션.
- **서버 액션**: 인가 → zod 검증 → 데이터 계층 upsert → `revalidatePath`.

- **실적 입력**: 고객사+월 선택 → 과업별 행(과업명·단가·**횟수 입력**·금액 자동) → 합계/누계/달성률 표시 → 일괄 저장(upsert).
- **지출 입력**: 고객사+월 선택 → 13종 분류별 금액 + 메모 → 저장.
- **청구·입금 입력**: 고객사+월 선택 → 청구액·입금액 두 값 → 저장.
- **설정(고객사·과업)**: 고객사 등록/수정(이름·상태·계약기간·담당 PM), 과업 등록/수정/삭제(이름·단가·계약금, `source=MANUAL`).

**랜딩 `/`**: Plan 2에서는 활성 사용자를 기본 화면(고객사 목록)으로 유도. 전사 대시보드는 Plan 3에서 `/`에 배치.

---

## 5. 데이터 흐름 & 파생·검증 규칙

### 실적 입력 흐름 (upsert)
1. 화면: `고객사 c + 연 y + 월 m` 선택 → `listTasks(ctx, c)` + `listPerformance(ctx, c, y, m)`로 과업별 현재 횟수 로드.
2. 사용자가 과업별 횟수 입력(클라이언트에서 `단가×횟수` 실시간 표시).
3. 저장 → 서버 액션: `requireUser` → zod(`{clientId, year, month, rows:[{taskId, count}]}`) → `upsertPerformanceBatch(ctx, ...)`.
4. 데이터 계층: 행마다 `MonthlyPerformance` upsert(`@@unique([taskId,year,month])`), 저장 시 **`amount = task.unitPrice × count`를 서버에서 재계산**(클라이언트 금액 신뢰 안 함). 같은 `withRLS` 트랜잭션 안에서 처리.

### 불변식·검증 규칙 (데이터 계층에서 강제)
- `amount`는 **항상 서버가 `단가×횟수`로 계산**해 저장. 클라이언트가 보낸 금액은 무시.
- **계약금도 `단가 × 계약횟수`로 서버 파생**: 과업 설정에서 계약금은 직접 금액이 아니라 `contractCount`(계약 횟수)로 입력하고, 서버가 `contractAmount = unitPrice × contractCount`로 계산해 저장한다(`contractCount`가 null이면 계약금도 null). 실적 `amount` 파생과 동일한 규칙. *(구현 중 반영된 결정 — 최초 설계의 "계약금 직접 입력"을 대체. `createTask`/`updateTask`의 입력은 `contractAmount`가 아니라 `contractCount`.)*
- `count ≥ 0`, `amount ≥ 0`, 청구·입금·지출 금액 `≥ 0` (정수, 원 단위, 부가세 포함).
- `month ∈ 1..12`, `year ∈ 2000..2100`.
- **없음(null) vs 0**: 계약금·청구액·입금액은 입력칸을 비우면 `null`(미입력), `0`을 넣으면 `0`. 실적 횟수 미입력 행은 저장하지 않음(레코드 없음 = 미입력).
- **과업 단가 변경 시 과거 실적 `amount`는 소급 재계산하지 않는다**(입력 시점 단가로 확정). 재계산이 필요하면 해당 월을 다시 저장.

### 청구·입금·지출 흐름
- 청구/입금: `MonthlyBilling`/`MonthlyDeposit` upsert(`@@unique([clientId,year,month])`).
- 지출: `Expense`는 `(client, year, month, category)` 단위. 분류별 한 행 upsert + 메모.
- **스키마 변경**: `Expense`에 `@@unique([clientId, year, month, category])` 유일 제약을 Plan 2 마이그레이션으로 추가(upsert 안전·중복 방지).

### RLS 컨텍스트
- `getRlsContext(sessionUser)` → `{userId: user.id, role}`. ADMIN/SETTLEMENT는 RLS 전체 통과, PM은 담당 고객사만. 데이터 계층은 역할을 몰라도 되고, RLS가 물리적으로 거른다.

---

## 6. 인가 & 에러 처리

### 인가 (이중 방어)
- **화면 진입**: 각 페이지 서버 컴포넌트가 `requireUser()` 또는 `requireRole("SETTLEMENT")`(지출/청구·입금/설정)로 가드. 권한 부족 시 Plan 1 규칙대로 리다이렉트.
- **서버 액션**: 액션도 **독립적으로** `requireRole`을 재호출(화면 가드에 의존하지 않음 — 액션은 별도 진입점). 인가 후 `ctx` 구성.
- **RLS 최종 방어**: PM이 타 고객사 ID를 위조해 액션을 호출해도 `withRLS` 안에서 RLS가 write를 거부(`WITH CHECK`) → upsert 0건/에러. 데이터 계층은 영향 행 수를 확인해 위조 시도를 실패로 처리.

### 에러 처리
- zod 파싱 실패 → 서버 액션이 `{ ok: false, error: "메시지" }` 반환(Plan 1 `approveUser` 반환 형태와 일치). 화면은 폼 상단에 한글 메시지 표시.
- 잘못된 값(음수 금액, 월 범위 밖 등)도 같은 경로로 사용자에게 한글 메시지.
- 없는 `clientId`/`taskId` 참조 → FK 위반 또는 RLS 거부 → 액션이 `{ ok:false }`로 변환, 500 노출 안 함.
- **반환 형태 표준**: 모든 변경 액션은 `Promise<{ ok: true } | { ok: false; error: string }>`. 성공 시 `revalidatePath`로 화면 갱신.

### 동시성·정합성
- 저장은 `withRLS` **트랜잭션 1개** 안에서 수행 → 실적 일괄 저장이 부분 실패하면 전체 롤백.
- upsert는 유일 제약 기반이라 재저장이 안전(idempotent).

---

## 7. 테스트 전략

Plan 1의 Vitest + 로컬 PostgreSQL(`roi_app` 역할, 5433 포트) 패턴을 잇는다. TDD: 각 태스크는 테스트 먼저.

**1) 데이터 계층 (DB 테스트, `roi_app`로 RLS 강제)**
- 파생: `upsertPerformanceBatch`가 `amount = 단가×횟수`로 저장(클라이언트가 보낸 틀린 금액 무시).
- upsert 멱등성: 같은 `(task,y,m)` 재저장 시 중복 없이 갱신.
- 지출 유일 제약: 같은 `(client,y,m,category)` 재저장이 갱신되는지.
- **RLS 격리(핵심)**: PM A 컨텍스트로 PM B 고객사의 실적/지출/청구·입금 저장·조회 시도 → 조회 0건, write 거부(영향 0건). Plan 1 `rls.test.ts` 패턴 확장.
- null vs 0: 계약금·청구·입금 미입력(null)과 0 구분 저장.

**2) 검증 스키마 (순수 단위 테스트, DB 불필요)**
- zod 스키마: 음수 금액·월 범위 밖(0,13)·비정수 거부, 정상값 통과.

**3) 인가 판정 (순수 단위 테스트)**
- 지출/청구·입금/설정 액션이 PM 역할을 거부하는지(Plan 1 `resolveGuard`/`hasAtLeast` 재사용, 필요 시 액션별 얇은 판정 함수 분리).

**4) 라벨/파생 유틸**
- WIP 흡수: `expenseCategoryLabel` 13종 테스트로 갱신(첫 태스크에서 기존 `labels.test.ts` 수정 → 통과 → 커밋).

**범위 밖(테스트 안 함)**: 화면 렌더링 E2E, 실시간 계산 UI(클라이언트 계산은 서버 재계산으로 신뢰하므로 로직 검증은 데이터 계층에서), 컴포넌트 스냅샷(YAGNI).

**검증 게이트**: 각 태스크 끝 `npm run test`(관련 필터) + 최종 `npm run build`.

---

## 8. 지출 분류 13종 (Plan 1 WIP 흡수)

Phase 1 설계 §5의 전체 목록. Plan 1에서 6종으로 시작했다가 13종 확장 작업이 커밋 안 된 채 남아 있음(테스트 미갱신). Plan 2 **첫 태스크**로 흡수: enum·라벨·마이그레이션 + `labels.test.ts` 갱신 → 통과 → 커밋.

| enum | 한글 라벨 |
|---|---|
| `CORPORATE_CARD` | 법인카드 |
| `PERSONAL_CARD` | 개인카드 |
| `LABOR_COUNSELOR` | 인건비(상담사) |
| `LABOR_INSTRUCTOR` | 인건비(강사) |
| `EDUCATION_PROGRAM` | 교육&프로그램 진행비 |
| `PROMOTION_OFFLINE` | 홍보비(오프라인) |
| `PROMOTION_EVENT` | 홍보비(이벤트) |
| `OPS_TRANSPORT` | 운영비(교통비) |
| `OPS_LODGING` | 운영비(숙박비) |
| `OPS_FOOD` | 운영비(식비) |
| `OPS_MEETING` | 운영비(회의비) |
| `TEST_MATERIAL` | 검사지 구매 |
| `GENERAL_ETC` | 일반관리(기타) |

---

## 9. Plan 3 로 넘기는 것 (경계 명확화)

- 전사/고객사 **집계 지표**(수익률·달성률·청구율·수금률) 계산 함수 — 단, Plan 2 데이터 계층이 조회 기반을 제공.
- 고객사 **상세** 화면(KPI·수익 흐름 깔때기·월별 추이·지출 구성).
- 전역 기간/고객사 필터 UI 및 필터 상태 관리.
- 랜딩 `/`의 대시보드 본문.
