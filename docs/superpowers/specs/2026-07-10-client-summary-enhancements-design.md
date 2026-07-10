# 고객사별 요약·과업별 실적 개선 설계

작성일: 2026-07-10

## 목적

수익률 대시보드의 "고객사별 요약"과 고객사 상세의 "과업별 실적"에 실사용(고객사 100여 개)을 위한 4가지 기능을 추가한다.

1. 과업별 실적을 월별로 분해해 보여준다.
2. 고객사별 요약을 10개씩 페이지네이션한다.
3. 고객사 정보에 업종 필드를 추가한다.
4. 고객사별 요약에 검색창과 정렬 토글(가나다순/PM별/업종별)을 추가한다.

## 공통 전제

- 데이터 계층(`src/lib/data`)과 검증(`src/lib/validation/schemas.ts`)은 순수 로직이므로 Vitest로 TDD.
- UI 상호작용(검색/정렬/페이지네이션)은 순수 헬퍼로 분리해 단위 테스트하고, 클라이언트 컴포넌트는 그 헬퍼를 사용만 한다.
- 스키마 변경은 로컬 PG(5433)에 `prisma migrate dev`로 적용한다.
- 기존 스타일·패턴(서버 컴포넌트 + server action + `withRLS`)을 그대로 따른다. 무관한 리팩터링은 하지 않는다.

## 기능 3 — 업종 필드 (기반, 먼저 구현)

업종은 다른 기능(편집 화면, 업종별 정렬)의 전제라서 먼저 만든다.

- `prisma/schema.prisma`: `Client` 모델에 `industry String?` 추가.
- 마이그레이션 `add_client_industry` 생성·적용.
- `clientSchema`(zod): `industry`를 빈 문자열/undefined → `null`로 매핑하는 optional nullable 문자열로 추가(기존 `pmId` preprocess 패턴과 동일). 자유 텍스트, 별도 형식 제약 없음.
- `ClientInput` 타입에 `industry?: string | null` 추가.
- `createClient`: `industry: input.industry ?? null` 저장.
- `updateClient`: `data`에 `industry: input.industry` 추가(undefined=스킵, null=클리어 patch 의미 유지).
- `createClientAction` / `updateClientAction`: `formData.get("industry")`를 파싱 대상에 추가.
- `NewClientForm`: "업종" 텍스트 입력칸 추가.

## 기능 3b — 고객사 정보 편집 화면 신설

현재 고객사 정보를 나중에 수정하는 UI가 없다(생성 + 과업·단가 설정만 존재). 업종을 기존 고객사에 채워 넣으려면 편집 수단이 필요하다.

- 대상 페이지: `src/app/(app)/settings/clients/[id]/page.tsx`. 이미 해당 client를 로드하므로, PM 목록(`user.findMany({ role: "PM", status: "ACTIVE" })`)만 추가 조회.
- 신규 클라이언트 컴포넌트 `EditClientForm`을 페이지 상단(과업·단가 위)에 배치. 이미 존재하는 `updateClientAction`에 연결.
- 편집 필드: 고객사명 / 상태 / 담당 PM / 계약 시작 / 계약 종료 / 업종. 초기값은 현재 client 값.
- `updateClientAction`은 `id`를 hidden 필드로 받는다(이미 그렇게 구현되어 있음).

## 기능 1 — 과업별 실적 월별 매트릭스

- `getClientDetail`의 과업 집계를 과업×월 금액으로 변경한다.
  - 타입 `TaskPerf = { id: string; name: string; monthly: number[]; total: number }`.
  - `monthly`는 선택 기간(`resolvePeriod(period)`의 `startMonth..endMonth`)에 해당하는 각 월의 실적 금액 배열, `total`은 그 합계.
  - 기존 `count`/`contractAmount`/`unitPrice` 필드는 이 표에서 사용하지 않으므로 반환에서 제외.
- 월 열의 범위는 기간 필터를 따른다: 전체=1~12(12열), 상반기=1~6, 하반기=7~12, 단일월=1열.
- `clients/[id]/page.tsx`의 "과업별 실적 (선택 구간)" 표를 매트릭스로 교체: 헤더 `과업 | (기간 내 각 월) | 합계`, 셀 = 금액(`formatWon`). 단가·계약금은 상단 KPI·수익 흐름에 이미 표시되므로 이 표에서는 제외.

## 기능 2 + 4 — 검색 + 정렬 토글 + 페이지네이션

데이터가 100여 개로 작으므로 서버 재조회 대신 클라이언트에서 처리한다(즉각 반응, 구현 단순).

- `getClientSummaries` 확장: `ClientSummary`에 `pmLabel: string`(미배정은 "미배정")과 `industry: string | null` 추가. PM 이름은 `getPmSummaries`처럼 `user.findMany`로 해석.
- 대시보드 "고객사별 요약" 표를 클라이언트 컴포넌트 `ClientSummaryTable`로 추출. 전체 목록을 props로 받아 브라우저에서 처리.
  - 검색창: 고객사명 부분일치(대소문자 무시) 필터.
  - 정렬 토글(기본 가나다순): `가나다순` / `PM별` / `업종별`.
    - 가나다순: 이름 `localeCompare(…, "ko")`.
    - PM별: pmLabel로 1차 정렬(미배정은 뒤), 이름 2차 정렬.
    - 업종별: industry로 1차 정렬(미분류/null은 뒤), 이름 2차 정렬.
  - 페이지네이션: 10개/페이지, 페이지 이동 컨트롤. 검색어나 정렬을 바꾸면 1페이지로 리셋.
- 정렬/필터/페이지네이션은 순수 헬퍼로 분리: `filterClients(list, query)`, `sortClients(list, mode)`, `paginate(list, page, size)`. 컴포넌트는 `useState`로 query/sort/page만 관리하고 이 헬퍼를 조합.

## 테스트

- `schemas.test.ts`: `clientSchema`의 industry 빈칸 → null, 값 유지.
- `data-clients.test.ts`: create/update에 industry 반영(생성 시 저장, update 시 변경·클리어).
- `data-metrics.test.ts`:
  - `getClientDetail`이 과업별 월 배열·합계를 기간에 맞게 반환.
  - `getClientSummaries`가 pmLabel(미배정 포함)과 industry를 반환.
- 신규 `test/client-summary-sort.test.ts`: `filterClients`/`sortClients`/`paginate` 헬퍼(가나다·PM별·업종별 정렬, 미배정/미분류 뒤로, 페이지 경계).

## 범위 밖 (하지 않음)

- 업종을 고정 목록/드롭다운으로 만들지 않는다(자유 텍스트).
- 검색이 PM·업종까지 검색하지 않는다(고객사명만).
- 정렬 토글에 그룹 헤더를 넣지 않는다(순서만 변경).
- 과업 매트릭스에 횟수/단가/계약금 열을 넣지 않는다(금액만).
