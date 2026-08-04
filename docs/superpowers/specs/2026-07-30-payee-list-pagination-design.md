# 지급 리스트 페이지네이션 설계

## 배경

`/expenses` 페이지 "지급 리스트" 탭(`PayeeListPanel.tsx`/`PayeePmListPanel.tsx`)은 검색 조건에 맞는 행을 매 요청마다 **전체 조회**해서 그대로 화면에 렌더링한다. 데이터가 수천 건 이상으로 늘어나는 추세라 UX(한 화면에 너무 많은 행)와 성능(매 요청 전체 복호화) 양쪽이 부담스러워지고 있어, 페이지네이션을 도입한다.

## 현재 상태 (조사 결과)

- `fetchMatchedPayees`(`src/lib/data/payees.ts`)가 `deletedAt: null` 조건으로 **전체 row**를 `orderBy: { keyId: "asc" }`로 조회한 뒤, 검색 필터가 있으면 **인메모리**로 걸러낸다.
- 검색 필드별 매칭 방식이 다르다:
  - `bizName`, `keyId` — 평문 컬럼, 대소문자 무관 부분일치(`toLowerCase().includes()`).
  - `phone`(PM 전용 검색 필드) — `phoneNormalized` 컬럼(암호화 안 된 정규화된 평문 숫자열)에 대해 부분일치.
  - `bizNumber`(ADMIN/SETTLEMENT 전용 검색 필드) — `bizNumberEnc`(암호문)를 매 row마다 복호화한 뒤 `digitsOnly()` 부분일치. 정확일치 전용 블라인드 인덱스(`bizNumberBidx`)로는 부분검색이 불가능해서 이 방식을 쓰고 있음.
- `listPayees`(ADMIN/SETTLEMENT), `listPayeesForPm`(PM), `listPayeesForExport`(엑셀 다운로드)가 모두 `fetchMatchedPayees` 결과를 각자의 응답 타입으로 매핑한다. `listPayees`/`listPayeesForPm`는 매핑 과정에서 `accountNumberEnc`를 **전체 row에 대해** 복호화한다.
- `PaymentListTab`(`page.tsx`)이 `listPayees`/`listPayeesForPm` 결과 전체를 `PayeeListPanel`/`PayeePmListPanel`에 props로 넘기고, 이 클라이언트 컴포넌트가 전체를 `<table>`로 렌더링한다. 검색 폼은 `<form method="get">`로 `?tab=payment-list&field=...&q=...`를 만들어 서버 컴포넌트를 다시 렌더링하는 방식(클라이언트 fetch 없음).
- 엑셀 다운로드(`exportHref`)는 선택된 행이 있으면 해당 `keyId` 목록, 없으면 현재 검색 조건(`field`/`q`) 전체로 별도 라우트(`/expenses/payees/export`)를 호출해 **검색 결과 전체**를 받는다 — 화면 페이지 크기와 무관하게 항상 전체 다운로드.

## 결정 사항

- **범위**: 이번 스펙은 페이지네이션 구현에만 집중한다. 사업자번호(`bizNumber`) 부분검색을 DB 레벨(블라인드 인덱스 확장 등)로 개선하는 작업은 암호화 인덱스 설계 변경과 별도 보안 리뷰가 필요한 작업이라 **범위에서 제외**하고 후속 스펙으로 分리한다.
- **페이지 크기**: 고정 50건 (`PAGE_SIZE = 50`). 사용자가 바꿀 수 있는 UI는 두지 않는다.
- **페이지네이션 방식**: 검색 필드에 따라 두 갈래로 나뉜다.
  - `bizName`/`keyId`/`phone` 검색 또는 검색 없음 → **DB 레벨** 페이지네이션. Prisma `where`에 `contains`(대소문자 무관) 조건을 걸고 `skip`/`take`로 해당 페이지만 조회, `count()`로 총 건수 조회. 두 쿼리 모두 기존 `withRLS` 트랜잭션 안에서 실행해 일관된 스냅샷을 보장한다.
  - `bizNumber` 검색 → 기존처럼 전체 조회 후 인메모리 복호화·필터링을 그대로 수행하고, 그 결과 배열의 길이를 `totalCount`로 삼아 `.slice(skip, skip + take)`로 페이지만 잘라 반환한다. (전체 스캔 비용은 기존과 동일 — 페이지네이션 도입 여부와 무관한 기존 특성.)
- **엑셀 다운로드는 페이지네이션의 영향을 받지 않는다** — `listPayeesForExport`는 지금처럼 페이지 개념 없이 검색 조건에 맞는 전체 결과를 반환한다.
- **페이지 이동 UI**: 이전/다음 버튼 + 페이지 번호 링크. 기존 검색 폼과 동일하게 URL 쿼리 파라미터(`page`) 기반 전체 페이지 새로고침 방식(클라이언트 상태 없음).
- **검색 조건 변경 시 페이지 리셋**: 검색 폼은 `field`/`q`(+ hidden `tab`)만 제출하므로, 제출 시 URL의 기존 `page` 파라미터는 자동으로 사라진다. 별도 리셋 로직 불필요.
- **전체선택 체크박스의 범위**: 페이지네이션 도입 후에는 `rows` prop이 "현재 페이지 행"만 담으므로, 전체선택 체크박스도 자연히 **현재 페이지 범위**로 동작한다. 엑셀 다운로드의 "선택 없으면 검색 결과 전체 다운로드" 동작은 페이지와 무관하게 그대로 유지된다(선택 스코프와 다운로드 스코프는 원래도 구분되어 있었음).

## 아키텍처 / 데이터 흐름

1. 사용자가 페이지 번호 링크 클릭 → GET `/expenses?tab=payment-list&field=...&q=...&page=2`
2. `page.tsx`의 `PaymentListTab`이 `parsePage(sp.page)`로 페이지 번호를 파싱(1 미만/숫자 아님이면 1로 클램프)하고 `listPayees(ctx, filter, page)` 또는 `listPayeesForPm(ctx, filter, page)` 호출.
3. `listPayees`/`listPayeesForPm` → `fetchMatchedPayees(ctx, filter, { page, pageSize: PAGE_SIZE })` 호출.
   - DB 필터 가능 필드: `tx.payee.findMany({ where, orderBy, skip, take, include })`와 `tx.payee.count({ where })`를 함께 실행.
   - `bizNumber` 필드: 기존 전체 조회 + 인메모리 필터 로직 재사용, 필터링된 배열을 슬라이스.
   - 반환값: `{ rows: MatchedPayee[]; totalCount: number }`.
4. `listPayees`/`listPayeesForPm`는 위 결과를 각자의 응답 타입으로 매핑하되, **해당 페이지 row에 대해서만** `accountNumberEnc` 복호화를 수행한다. 최종 반환 타입은 `{ rows: PayeeRow[]; page: number; totalPages: number }`(PM은 `PayeePmRow[]`).
5. `PaymentListTab`이 `page`/`totalPages`를 `PayeeListPanel`/`PayeePmListPanel`에 props로 전달.
6. 각 패널은 테이블 하단에 공용 컴포넌트 `PayeePager`를 렌더링. `totalPages <= 1`이면 렌더링하지 않는다. 이전/다음 및 번호 링크는 `?tab=payment-list&field=...&q=...&page=N` 형태로 현재 검색 조건을 유지한 채 페이지만 바꾼다. 현재 페이지 번호는 링크가 아닌 비활성 텍스트로 표시.

## 변경 파일

- `src/lib/data/payees.ts`
  - `PAGE_SIZE = 50` 상수 추가.
  - `parsePage(value: string | undefined): number` 추가 — 1 미만이거나 숫자가 아니면 1.
  - `fetchMatchedPayees`가 항상 `{ rows: MatchedPayee[]; totalCount: number }`를 반환하도록 변경(페이지네이션 파라미터는 옵션). 파라미터를 생략하면 `skip` 없이 전체를 `rows`로, `totalCount`는 `rows.length`로 채운다 — export 경로는 `rows`만 꺼내 쓰고 `totalCount`는 무시.
  - `listPayees`/`listPayeesForPm` 시그니처에 `page: number` 인자 추가, 반환 타입을 `{ rows, page, totalPages }` 형태로 변경.
  - `listPayeesForExport`는 동작 변경 없음(페이지네이션 파라미터 없이 `fetchMatchedPayees` 호출, `rows`만 사용).
- `src/app/(app)/expenses/page.tsx`
  - `searchParams` 타입에 `page?: string` 추가.
  - `PaymentListTab`에서 `parsePage(sp.page)` 호출 후 `listPayees`/`listPayeesForPm`에 전달, 반환된 `page`/`totalPages`를 각 패널에 props로 전달.
- `src/app/(app)/expenses/PayeePager.tsx` (신규, 공용 컴포넌트)
  - props: `page`, `totalPages`, `tab`(고정값 `"payment-list"`), `field`, `q`.
  - 이전/다음 버튼 + 페이지 번호 링크 렌더링. `page === 1`이면 이전 버튼, `page === totalPages`면 다음 버튼을 비활성화(링크 대신 비활성 버튼).
- `src/app/(app)/expenses/PayeeListPanel.tsx`, `PayeePmListPanel.tsx`
  - `page`/`totalPages` props 추가, 테이블 하단에 `PayeePager` 삽입.

## 범위 밖 (변경하지 않음)

- 사업자번호(`bizNumber`) 부분검색의 DB 레벨 인덱싱 개선 — 후속 스펙에서 별도 진행.
- 엑셀 다운로드 로직 — 페이지네이션과 무관하게 전체 다운로드 유지.
- 페이지 크기를 사용자가 바꾸는 UI — 이번 범위 아님.
- role 가드 로직 — 변경 없음.

## 테스트 계획

- `test/data-payees.test.ts`
  - DB 필터 가능 필드(`bizName`/`keyId`/`phone`)로 검색 시 `skip`/`take`가 올바르게 적용되고 `totalCount`가 필터링된 전체 건수와 일치하는지.
  - `bizNumber` 검색 시 인메모리 필터링 후 슬라이스가 올바른 페이지를 반환하는지.
  - `page`가 `totalPages`보다 클 때 빈 배열 + 정확한 `totalPages` 반환(에러 아님).
  - `listPayeesForExport`가 페이지네이션과 무관하게 전체 결과를 반환하는지(회귀 방지).
  - `parsePage` 경계값(0, 음수, 소수, 문자열, undefined) → 1로 클램프.
- 수동 검증: 지급 리스트 화면(ADMIN/PM 둘 다)에서 페이지 이동, 검색 조건 변경 시 1페이지로 리셋되는지, 마지막 페이지의 이전/다음 버튼 비활성화, 엑셀 다운로드가 페이지 무관하게 전체를 받는지.
