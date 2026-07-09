# ROI 대시보드 — Plan 3 설계 문서 (수익률 대시보드)

- **작성일:** 2026-07-09
- **작성자:** 류승환 (shryu@huno.kr) + Claude
- **범위:** Phase 1(1단계)의 세 번째 구현 주기. 전사 대시보드 + 고객사 상세 + 집계 지표 시각화 + 전역 기간 필터.
- **상위 설계:** `docs/superpowers/specs/2026-07-08-roi-dashboard-phase1-design.md`
- **선행 구현:** Plan 1(`2026-07-08-...-foundation.md`, 완료), Plan 2(`2026-07-09-...-phase2-crud.md`, 완료)

---

## 1. 배경과 위치

Phase 1 설계 문서는 1단계 전체(기반 + 수동 CRUD + 수익률 대시보드)를 정의한다. 그 구현은 세 주기로 나뉜다:

| Plan | 내용 | 상태 |
|---|---|---|
| Plan 1 | 기반: 인증·RBAC·데이터 모델·PostgreSQL RLS·`withRLS`·서버 가드·관리자 사용자 승인 | 완료 |
| Plan 2 | 데이터 접근 계층 + 공통 셸 + 고객사/과업/단가 설정 + 고객사 목록 + 실적/지출/청구·입금 입력 | 완료 |
| **Plan 3** | **본 문서** — 수익률 대시보드(전사/고객사 상세 KPI·수익 흐름·추이·지출 구성) + 전역 기간 필터 | 설계 |

Plan 2의 forward reference("고객사 상세, 전사 집계 지표, 전역 기간/고객사 필터, 대시보드 본문은 Plan 3")를 그대로 잇는다. Plan 2가 만든 데이터 계층(`src/lib/data/*`, 모두 `withRLS` 경유)과 셸(`(app)` 레이아웃·사이드바)을 재사용한다.

**Plan 3 목표:** @huno.kr 사용자가 역할에 맞는 대시보드에서 계약금·실적·청구·입금·지출을 집계한 KPI(수익률·달성률·청구율·수금률), 수익 흐름 깔때기, 월별 추이, 지출 구성을 한눈에 보고, 고객사 상세로 드릴다운하며, CSV로 내보내는 조회 계층을 완성한다. PM은 RLS로 본인 담당 고객사만 집계된다.

---

## 2. 범위

### 포함
- **전사 대시보드**(`/`): KPI 카드 5종 + 수익 흐름 깔때기 + 월별 추이 + 지출 구성 도넛 + PM별 집계 + 고객사별 요약.
- **고객사 상세**(`/clients/[id]`): 고객사 KPI + 수익 흐름 + 과업별 실적 + 월별 실적·청구·입금 표(미입금 강조) + CSV 내보내기.
- **전역 기간 필터**: `연도 + 기간구분(전체/상반기/하반기/특정월)`. KPI는 선택 구간 합산, 월별 추이는 선택 연도 12개월 고정.
- **PM별 집계 섹션**(ADMIN/SETTLEMENT 전용): PM별 담당 합산(수익률·실적). 순위/리더보드 아님, 단순 수치 나열.
- **CSV 내보내기**: 고객사 상세의 월별 실적·청구·입금·지출을 CSV로 다운로드.
- **미입금 강조**: 고객사 상세 월별 표에서 청구액 > 입금액인 달(미수금)을 시각적으로 강조.
- **차트 구현**: 라이브러리 없이 SVG/CSS로 직접 렌더(막대·도넛·깔때기·라인). 신규 런타임 의존성 없음.
- **네비게이션**: 사이드바에 "대시보드"(`/`) 항목 추가(모든 역할).

### 제외 (다른 Phase/범위 외)
- 파일 자동 파싱(산출내역서 PDF·세금계산서·입금 엑셀) → Phase 2
- 구글 시트 이관·내보내기, 캘린더 연동 → Phase 3
- 부가세 계산·표시, 순위/리더보드 → 범위 외(Phase 1 설계 §9)
- 전역 **고객사** 필터: 대시보드는 전사/드릴다운 구조로 충분하므로 도입하지 않음. (기간 필터만 전역.)
- 사전집계(materialized view·집계 테이블): Phase 1 데이터 규모에선 불필요(YAGNI). Prisma `aggregate`/`groupBy`로 충분. 성능 이슈 발생 시 후속.

### 확정된 정책 결정
- **달성률 기준**: `실적 달성률 = 선택 구간 실적 / 총 계약금`. 모든 KPI가 동일한 선택 구간을 기준으로 삼는다(일관성). 계약금(`Task.contractAmount`)은 과업의 총 계약 금액이라 연/월이 없으므로 기간 필터를 적용하지 않고 합산한다.
- **월별 추이 지표**: **월별 실적(막대) + 월별 수익률(라인)**. Phase 1 설계 §7.1은 "수익률·실적 달성률"로 표현했으나, 달성률은 총계약금 기준이라 월 단위로 쪼개면 의미가 혼동되므로 추이에서는 제외한다.
- **CSV 방식**: server action이 아닌 **route handler(GET)** 로 처리. 파일 다운로드는 응답 스트림이 자연스럽고, `requireUser` + `withRLS`로 RLS를 동일하게 강제할 수 있다.

---

## 3. 아키텍처 — 조회/집계 계층

Plan 2가 확립한 3층 패턴(순수 함수 + `withRLS` 데이터 계층 + 화면)을 그대로 확장한다.

```
서버 컴포넌트(대시보드/상세 화면)
   │ ① requireUser (인가·미승인 리다이렉트)
   │ ② searchParams → period.ts 로 {year, period} 파싱
   │ ③ getRlsContext(user) → ctx
   ▼
데이터 계층  src/lib/data/metrics.ts
   getPeriodTotals(ctx, year, period) / getMonthlyTrend(ctx, year) ...
   │  모든 함수가 첫 인자로 RlsContext 를 받아
   ▼
withRLS(ctx, tx => tx.<model>.aggregate/groupBy(...))   ← Plan 1 헬퍼
   ▼
PostgreSQL (RLS 정책이 PM 접근을 물리적으로 차단 → PM 집계는 자동으로 본인 담당만)
   │
   ▼
순수 계층  src/lib/metrics/formulas.ts  ── 합계 → KPI(수익률·달성률·청구율·수금률), 0나눗셈·null 처리
```

**핵심 원칙 (Plan 2 계승)**
- **모든 데이터 접근은 `withRLS` 경유.** 집계 쿼리도 예외 없음. RLS를 우회하는 경로를 만들지 않는다.
- **PM 범위는 RLS가 물리적으로 강제.** 대시보드 코드에 "PM이면 필터" 분기를 두지 않는다. ADMIN/SETTLEMENT ctx는 전체, PM ctx는 담당 고객사만 집계된다.
- **파생·불변식은 순수 계층 한 곳.** KPI 공식, 0나눗셈, null 계약금 제외를 `formulas.ts`에서만 처리하고 화면은 결과를 표시만 한다.
- **차트는 프레젠테이션 전용.** 데이터를 받아 SVG/CSS로 그리는 순수 컴포넌트. 정적 렌더라 서버 컴포넌트(RSC)로 둔다.

### 신규 파일

**순수 로직 (DB 불필요, 단위 테스트)**
- `src/lib/period.ts` — 기간구분 타입·상수, `resolvePeriod(period) → {startMonth, endMonth}`, `parsePeriodParams(searchParams) → {year, period}`.
- `src/lib/metrics/formulas.ts` — `margin`, `attainment`, `billingRate`, `collectionRate` (각각 `number | null` 반환), `csvFromRows(rows) → string`.
- `src/lib/format.ts` (수정) — `formatWon`, `formatPercent` 추가(기존 `formatThousands`·`digitsOnly` 유지·재사용).

**데이터 계층 (`withRLS`, RLS DB 테스트)**
- `src/lib/data/metrics.ts` — 아래 §5 함수들.

**컴포넌트 (프레젠테이션)**
- `src/components/charts/KpiCard.tsx` — KPI 카드(제목·값·보조).
- `src/components/charts/FunnelChart.tsx` — 수익 흐름 4단(계약금→실적→청구→입금) 막대.
- `src/components/charts/DonutChart.tsx` — 지출 구성 도넛(SVG `stroke-dasharray`) + 범례.
- `src/components/charts/TrendChart.tsx` — 월별 추이(SVG 막대 + `polyline` 라인).
- `src/components/charts/BarList.tsx` — 고객사별/PM별 가로 막대 목록.
- `src/components/dashboard/PeriodFilter.tsx` — `method="get"` 기간 필터 폼(기존 입력 화면 패턴과 동일).

**화면·라우트**
- `src/app/(app)/dashboard/page.tsx` — 전사 대시보드 본문. `(app)` 그룹 안에 두어 공통 셸 레이아웃을 적용받는다.
- `src/app/page.tsx` (수정) — 루트를 `/dashboard`로 리다이렉트(기존 `/clients` 리다이렉트를 교체).
- `src/app/(app)/clients/[id]/page.tsx` — 고객사 상세.
- `src/app/(app)/clients/[id]/export/route.ts` — CSV route handler(GET).
- `src/lib/shell/nav.ts` (수정) — "대시보드" 항목 추가.
- `src/app/(app)/clients/page.tsx` (수정) — 카드 링크를 `/performance` → `/clients/[id]`로 변경.

**의존성 추가:** 없음.

---

## 4. 화면/컴포넌트 구성

### 라우트 (App Router, 인증 셸 그룹 `(app)`)

| 경로 | 화면 | 접근 역할 |
|---|---|---|
| `/` (`src/app/page.tsx`) | `/dashboard`로 리다이렉트 | — (requireUser 후 이동) |
| `(app)/dashboard/page.tsx` | 전사 대시보드 | 활성 전체 (PM은 RLS로 본인 담당만) |
| `(app)/clients/page.tsx` | 고객사 목록(→상세 링크) | 활성 전체 |
| `(app)/clients/[id]/page.tsx` | 고객사 상세 | 활성 전체 + RLS |
| `(app)/clients/[id]/export/route.ts` | CSV 다운로드(GET) | 활성 + RLS |

> **랜딩 결정**: Plan 2 Task 15는 `/`를 `/clients`로 리다이렉트했다. Plan 3는 `/`를 `/dashboard`로 리다이렉트하도록 바꾼다. 대시보드 본문을 `(app)/dashboard`에 두는 이유는 공통 셸 레이아웃(`(app)/layout.tsx`)을 그대로 적용받기 위해서다.

### 전사 대시보드 (`/dashboard`) 구성
1. **상단 기간 필터**: `[연도 ▾] [전체 | 상반기 | 하반기 | 1월…12월]` (GET 폼).
2. **KPI 카드 5종**: 수익률 · 실적 달성률 · 총 실적 · 총 지출 · 총 입금.
3. **수익 흐름 깔때기**: 계약금(총) → 실적(구간, 달성률) → 청구(구간, 청구율) → 입금(구간, 수금률). 4단 막대 + 단계별 전환율.
4. **월별 추이**: 선택 연도 12개월 — 월별 실적(막대) + 월별 수익률(라인).
5. **지출 구성 도넛**: 13종 분류별 구간 합 + 범례(금액·비율).
6. **PM별 집계 표**(ADMIN/SETTLEMENT 전용, `hasAtLeast(role,"SETTLEMENT")`로 게이트): PM · 담당 고객사 수 · 구간 실적 · 구간 지출 · 수익률.
7. **고객사별 요약 표**: 고객사 · 실적 · 지출 · 수익률 · 달성률 (각 행 → 상세 링크).

### 고객사 상세 (`/clients/[id]`) 구성
1. 상단 기간 필터(연도만 유의미하게 노출, 표는 12개월 표시) + CSV 내보내기 버튼.
2. **고객사 KPI 4종**: 수익률 · 달성률 · 청구율 · 수금률.
3. **수익 흐름 깔때기**(고객사 단위).
4. **과업별 실적 표**: 과업 · 단가 · 계약금 · 구간 실적(횟수·금액).
5. **월별 실적·청구·입금 표**: 12개월 × (실적·청구·입금·지출). **청구 > 입금인 달은 미수금으로 빨강 강조 + 미수금액 표기.**

### 공통 셸 변경
- `nav.ts`: 모든 역할의 메뉴 맨 앞에 `{ href: "/dashboard", label: "대시보드" }` 추가. (PM도 대시보드 접근, RLS로 본인 담당만 집계.)
- `clients/page.tsx`: 카드 클릭 시 `/clients/[id]` 상세로 이동(기존 `/performance?clientId=`에서 변경).

### 컴포넌트 경계
- **서버 컴포넌트(화면)**: `requireUser` → 기간 파싱 → `ctx` → 데이터 계층 집계 호출 → `formulas.ts`로 KPI 계산 → 차트 컴포넌트에 props 전달.
- **차트 컴포넌트**: 순수 프레젠테이션(정적 SVG/CSS, RSC). 상호작용(툴팁 등)은 Phase 1 범위 밖 — 값은 표/범례로 함께 표기해 정보 손실을 막는다.
- **기간 필터**: `method="get"` 폼(클라이언트 상태 없음, searchParams가 단일 출처).

---

## 5. 데이터 계층 (`src/lib/data/metrics.ts`)

모든 함수는 첫 인자로 `ctx: RlsContext`를 받아 `withRLS` 안에서 Prisma `aggregate`/`groupBy`로 집계한다. `period`는 `resolvePeriod`로 `{startMonth, endMonth}`를 얻어 `month: { gte, lte }` 필터에 사용한다.

| 함수 | 반환 | 설명 |
|---|---|---|
| `getPeriodTotals(ctx, year, period)` | `{ performance, billing, deposit, expense }` | 구간 합계(실적=MonthlyPerformance.amount 합, 청구·입금·지출 합). |
| `getContractTotal(ctx)` | `number` | 총 계약금 = `Task.contractAmount` 합(null 제외, 기간 무관). |
| `getMonthlyTrend(ctx, year)` | `Array<{ month, performance, expense }>` (12행) | 월별 실적·지출 합. 없는 달은 0. |
| `getExpenseBreakdown(ctx, year, period)` | `Array<{ category, amount }>` | 13종 category별 구간 합. |
| `getClientSummaries(ctx, year, period)` | `Array<{ id, name, performance, expense, contract }>` | 고객사별 구간 실적·지출 + 총계약금. |
| `getPmSummaries(ctx, year, period)` | `Array<{ pmId, email, name, clientCount, performance, expense }>` | client.pmId 기준 rollup. ADMIN/SETTLEMENT만 호출(전체 ctx). |
| `getClientDetail(ctx, id, year, period)` | `{ client, tasks[], monthly[] }` | 상세 화면용: 과업별 구간 실적 + 12개월 실적·청구·입금·지출. RLS로 타 고객사면 빈/차단. |

**집계 규칙**
- 실적 합은 `MonthlyPerformance.amount`(저장 시 `단가×횟수`로 확정된 값) 합계. 단가 변경 소급 없음(Plan 2 규칙).
- 계약금은 `Task.contractAmount`가 `null`인 과업은 제외하고 합산.
- `getPmSummaries`는 PM 목록(`User`, RLS 미적용)과 client.pmId groupBy를 조합. PM이 없는(미배정) 고객사는 별도 "미배정" 행으로 묶거나 제외 — 구현 시 "미배정"으로 표기.
- RLS가 PM ctx에서 타 고객사 행을 숨기므로, PM 대시보드의 모든 집계는 자동으로 본인 담당만 반영된다.

**CSV**: `csvFromRows(rows: string[][]) → string`(순수, `formulas.ts` 또는 별도 `csv.ts`). route handler는 `getClientDetail`로 데이터를 얻어 CSV 문자열을 만들고, 한글 Excel 호환을 위해 UTF-8 BOM(`﻿`)을 앞에 붙여 `text/csv`로 응답한다.

---

## 6. 지표 공식 (`src/lib/metrics/formulas.ts`, 순수·테스트 대상)

각 함수는 합계(정수)를 입력받아 비율(`number`, 0~1) 또는 `null`을 반환한다. 화면은 `null`을 "—"로 표시한다.

| 함수 | 공식 | null 조건 |
|---|---|---|
| `margin(performance, expense)` | `(performance − expense) / performance` | `performance === 0` |
| `attainment(performance, contract)` | `performance / contract` | `contract === 0` (계약금 없음) |
| `billingRate(billing, performance)` | `billing / performance` | `performance === 0` |
| `collectionRate(deposit, billing)` | `deposit / billing` | `billing === 0` |

- 음수 방지: 입력은 이미 `≥ 0`(Plan 2 불변식). 수익률은 지출 > 실적이면 음수가 될 수 있고, 이는 정상(적자)으로 표시.
- `formatPercent(v: number | null)` → `null`이면 "—", 아니면 `(v*100).toFixed(1) + "%"`.

---

## 7. 인가 & 에러 처리 (Plan 1·2 계승)

- **화면 진입**: 대시보드·상세 페이지 서버 컴포넌트가 `requireUser()`로 가드(미인증→`/login`, 미승인/비활성→`/pending`). 상세는 추가로 `getClientDetail`이 RLS로 타 고객사 접근을 차단(결과 없으면 `notFound()`).
- **PM별 집계 게이트**: `getPmSummaries` 호출과 표 렌더는 `hasAtLeast(user.role, "SETTLEMENT")`일 때만. PM에게는 해당 섹션 자체를 렌더하지 않는다.
- **CSV route handler**: `auth()`/`requireUser` 상당의 세션 확인(Node 런타임) 후 `withRLS`로 조회. 미인증·타 고객사는 404/빈 CSV.
- **조회 전용**: Plan 3는 읽기만 한다. 변경 액션·`revalidatePath` 없음. 입력은 Plan 2 화면이 담당.
- **빈 데이터**: 데이터 없는 구간은 KPI "—", 차트는 빈 상태 문구("데이터가 없습니다"). 0나눗셈은 순수 계층에서 `null`로 흡수.

---

## 8. 테스트 전략 (Plan 1·2 패턴 계승)

Vitest + 로컬 PostgreSQL(`roi_app` 역할, 5433 포트). TDD: 각 태스크 테스트 먼저.

**1) 순수 단위 테스트 (DB 불필요)**
- `test/period.test.ts` — `resolvePeriod`: 전체→1..12, 상반기→1..6, 하반기→7..12, 특정월→m..m. `parsePeriodParams`: 기본값·범위 밖 방어.
- `test/metrics-formulas.test.ts` — 4개 공식 정상값 + 경계: 실적=0→null, 계약금=0→null, 청구=0→수금률 null, 적자(음수 수익률) 허용. `formatPercent`/`formatWon`.
- CSV: `csvFromRows` 정상 직렬화(콤마·따옴표 이스케이프), BOM은 route handler 책임이라 별도.

**2) 데이터 계층 (DB 테스트, `roi_app`로 RLS 강제 — 핵심)**
- `test/data-metrics.test.ts`:
  - `getPeriodTotals`: 구간(예: 상반기) 필터가 월 범위로 정확히 합산.
  - `getContractTotal`: null 계약금 제외 합.
  - **RLS 격리**: PM A ctx의 모든 집계(`getPeriodTotals`·`getMonthlyTrend`·`getExpenseBreakdown`·`getClientSummaries`·`getClientDetail`)가 본인 담당 고객사만 반영, PM B 데이터는 0/제외. (Plan 1 `rls.test.ts`, Plan 2 데이터 테스트 패턴 확장.)
  - `getPmSummaries`: ADMIN ctx에서 PM별 rollup이 담당 고객사 수·합계 정확. 미배정 고객사 처리.
  - `getMonthlyTrend`: 없는 달 0으로 채워 12행.

**3) 네비게이션**
- `test/nav.test.ts` (수정) — 모든 역할 첫 항목이 `/dashboard`인지, 기존 역할별 항목 유지 확인.

**범위 밖(테스트 안 함)**: 차트 SVG 렌더 스냅샷, route handler E2E, 화면 통합(YAGNI, Plan 2 정책 계승). 차트는 순수 프레젠테이션이라 입력 props 계산 로직만 데이터·순수 계층에서 검증.

**검증 게이트**: 각 태스크 끝 `npm run test`(관련 필터) + 최종 `npm run test` 전체 + `npm run build`.

---

## 9. Phase 2 로 넘기는 것 (경계 명확화)

- 파일 자동 파싱(산출내역서 PDF→계약금·과업·단가, 세금계산서→청구액, 입금 엑셀→입금액).
- 구글 시트 이관·내보내기(단순 CSV 내보내기는 Plan 3 포함), 캘린더 연동.
- 부가세, 순위/리더보드, 차트 상호작용(툴팁·드릴다운 애니메이션).
- 사전집계(집계 테이블·materialized view) — 데이터 규모 증가 시 성능 최적화로 후속.
