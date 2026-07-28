# 지급 리스트 검색 기능 설계

## 배경

`/expenses` 페이지의 "지급 리스트" 탭(`PayeeListPanel.tsx`)에는 검색 UI(필드 선택 드롭다운 + 검색어 입력 + 조회 버튼)가 이미 배치돼 있으나 조회 로직이 연결되어 있지 않다. 이 문서는 그 검색 기능의 설계를 정리한다.

## 현재 상태 (조사 결과)

- 탭/데이터 접근 권한: "지급 리스트" 탭은 `tabs.ts`에서 `roles: ["ADMIN", "SETTLEMENT"]`로 제한되어 있고, `listPayees()`도 동일하게 `ADMIN`/`SETTLEMENT` 외 역할은 예외를 던진다. 즉 이 화면에 도달 가능한 역할은 두 가지뿐이다(PM 등은 접근 자체가 불가).
- 사업자번호는 DB에 평문이 없다. `bizNumberEnc`(AES-256-GCM 암호문), `bizNumberMasked`(마스킹 표시값), `bizNumberBidx`(HMAC 블라인드 인덱스, 정확일치 전용)만 존재한다.
- `PayeeRow`(클라이언트로 전달되는 타입)에는 `bizNumberMasked`만 포함되고 원문/블라인드인덱스는 포함되지 않는다(최근 커밋에서 강화됨).
- 기존 "전체 내역" 탭(`AllExpensesTab`)은 `<form method="get">` 기반으로 검색 조건을 URL 쿼리 파라미터로 전달하고 서버 컴포넌트가 재조회하는 패턴을 이미 사용 중이다.

## 결론: 역할별 검색 범위 차등 불필요

"정산담당자만 사업자번호 원문 검색 가능, 그 외 역할은 마스킹 값 기준 검색"이라는 요구를 검토한 결과, 이 화면에 도달 가능한 역할이 이미 `ADMIN`/`SETTLEMENT`뿐이므로(다른 역할은 탭/데이터 레벨에서 이미 차단됨) 검색 기능 안에 별도의 역할 분기를 추가할 필요가 없다. `ADMIN`은 `SETTLEMENT`보다 상위 권한(rank 3 > 2)이므로 동일하게 취급한다.

## 결정 사항

- **사업자번호 검색 방식**: 부분일치 지원. 서버에서 매 조회 시 대상 row의 `bizNumberEnc`를 복호화해 in-memory로 비교한다(정확일치 전용 블라인드 인덱스로는 부분 검색이 불가능하기 때문).
- **조회 실행 방식**: GET 폼 기반 페이지 재조회. 기존 "전체 내역" 탭과 동일한 패턴(`?tab=payment-list&field=...&q=...`)을 사용한다.

## 아키텍처 / 데이터 흐름

1. 사용자가 검색 필드 선택 + 검색어 입력 + [조회] 클릭 → GET `/expenses?tab=payment-list&field=bizNumber&q=1234`
2. `page.tsx`가 `sp.field`/`sp.q`를 파싱해 `listPayees(ctx, filter)` 호출
3. `listPayees`는 전체 row를 조회한 뒤(기존과 동일한 쿼리) 필터가 있으면 필드별 매칭 로직을 적용하고, 매칭된 row만 `PayeeRow[]`로 매핑해 반환한다. 사업자번호 원문은 필터링에만 쓰이고 응답(`PayeeRow`)에는 여전히 마스킹된 값만 포함된다.
4. `PayeeListPanel`은 필터링된 rows와 현재 field/q 값(입력창 유지용)을 props로 받아 렌더링한다.

## 검색 매칭 규칙

- 공통: 검색어를 trim한 결과가 빈 문자열이면 필터를 적용하지 않는다(전체 표시).
- **사업자명(이름)**: `bizName`에 대해 대소문자 무관 부분일치(`toLowerCase().includes(...)`).
- **고유번호**: `keyId`에 대해 대소문자 무관 부분일치.
- **사업자번호**: 대상 row의 `bizNumberEnc`를 복호화 → `digitsOnly()`로 하이픈 등 비숫자 문자 제거 → 검색어도 동일하게 `digitsOnly()` 적용 후 부분일치 확인. `field !== "bizNumber"`인 경우에는 사업자번호 복호화 자체를 수행하지 않는다(불필요한 복호화 방지).
- 알 수 없는 `field` 값(URL 조작 등)이 들어오면 필터를 무시하고 전체 목록을 표시한다. 별도 에러 UI는 없다.

## 변경 파일

- `src/lib/data/payees.ts` — `listPayees(ctx, filter?: { field: "bizName" | "bizNumber" | "keyId"; q: string })`로 시그니처 확장, 위 매칭 규칙 구현.
- `src/app/(app)/expenses/page.tsx` — `searchParams` 타입에 `field?`/`q?` 추가, `PaymentListTab`에서 파싱 후 `listPayees` 및 `PayeeListPanel`에 전달.
- `src/app/(app)/expenses/PayeeListPanel.tsx` — 검색 영역을 `<form method="get">`로 전환(`AllExpensesTab`과 동일한 hidden `tab` 인풋 패턴 포함), `<option>` value를 내부 키(`bizName`/`bizNumber`/`keyId`)로 정리, `field`/`q`를 props로 받아 `defaultValue`로 검색 상태 유지, 결과 0건일 때 "검색 결과가 없습니다"(필터 있음) vs "등록된 지급 대상이 없습니다"(필터 없음) 문구 분기.

## 범위 밖 (변경하지 않음)

- 기존 role 체크(`listPayees` 앞단 `ADMIN`/`SETTLEMENT` 검증) 로직 자체는 변경하지 않는다.
- 페이지네이션은 도입하지 않는다(기존에도 없음, 이번 변경과 무관).
- 검색 중 편집/선택 상태 초기화는 허용한다(GET 재조회 특성상 자연스럽게 초기화됨, 별도 보존 로직 없음).

## 테스트 계획

- 단위 테스트(`listPayees` 필터 로직): 사업자명 부분일치(대소문자 섞임 포함), 고유번호 부분일치, 사업자번호를 하이픈 포함/제외 두 형태로 입력했을 때 동일하게 매칭되는지, 빈 검색어일 때 전체 반환되는지.
- 수동 검증: 지급 리스트 화면에서 필드별 검색 → 결과 확인, 빈 검색어로 조회 시 전체 표시 확인, 검색 결과 0건일 때 문구 확인.
